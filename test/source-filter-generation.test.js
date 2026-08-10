const test = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const { generateAndSave } = require('../src/services/generation');
const realSourceFilter = require('../src/services/sourceFilter');
const realContent = require('../src/services/content');

const fakeImages = { createSlides: async () => ['/generated/slide.jpg'] };

function verifiedContent(topic) {
  return {
    focus: { masalah: 'Masalah', penyebab: 'Penyebab', solusi: 'Solusi', hasil: 'Hasil' },
    topic,
    hook: 'Hook natural',
    body: 'Isi terverifikasi',
    caption: 'Isi terverifikasi',
    hashtags: [],
    cta: 'Penutup natural',
    trendKeywordsUsed: [],
    content_angle: 'angle sumber',
    primary_tool: 'tanpa tool',
    hook_pattern: 'hook natural',
    verificationStatus: 'source_based',
    unsupportedClaims: [],
    slides: [
      { section: 'PEMBUKA', title: 'Hook natural', body: 'Pembuka bermakna.', points: [] },
      { section: 'PENJELASAN', title: 'Fakta pertama', body: 'Isi terverifikasi.', points: [] },
      { section: 'PENJELASAN', title: 'Fakta kedua', body: 'Isi lain terverifikasi.', points: [] },
      { section: 'PENUTUP', title: 'Penutup natural', body: 'Cek konteksnya.', points: [] }
    ]
  };
}

test('source mode memakai persis URL user dan melewati sourceFilter, bukan source generation lama', async () => {
  const db = createDatabase(':memory:');
  const requestedUrls = ['https://one.test/article', 'https://two.test/article'];
  let fetchedUrls;
  let filterInput;
  let directGenerateCalls = 0;

  const sourceFetcher = {
    validateSourceUrls: urls => urls,
    fetchSources: async urls => {
      fetchedUrls = [...urls];
      return urls.map((url, index) => ({ url, finalUrl: url, title: `Sumber ${index + 1}`, text: `Isi sumber ${index + 1} yang cukup panjang untuk tes.`, fetchedAt: '2026-08-08T00:00:00.000Z' }));
    }
  };
  const content = {
    generateContent: async () => {
      directGenerateCalls += 1;
      throw new Error('generation.js tidak boleh memanggil source generation lama secara langsung');
    }
  };
  const sourceFilter = {
    generateFilteredContent: async input => {
      filterInput = input;
      return verifiedContent('Topik manual baru');
    }
  };

  const id = await generateAndSave({
    db,
    mode: 'manual',
    requestedTopic: 'Topik manual baru',
    category: 'Edukasi teknologi',
    format: 'Fakta singkat',
    useSources: true,
    sourceUrls: requestedUrls,
    sourceFetcher,
    sourceFilter,
    content,
    images: fakeImages,
    useTrendReference: false
  });

  assert.equal(directGenerateCalls, 0);
  assert.deepEqual(fetchedUrls, requestedUrls);
  assert.deepEqual(filterInput.sources.map(source => source.url), requestedUrls);
  assert.equal(filterInput.options.requestedTopic, 'Topik manual baru');
  assert.equal(filterInput.options.contentFormat, 'Fakta singkat');
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Topik manual baru');
  db.close();
});

test('AI dengan satu URL memakai pipeline source-backed dan menentukan topik tanpa requestedTopic', async () => {
  const db = createDatabase(':memory:');
  const sourceUrl = 'https://example.com/astra';
  const evidence = 'Pengembangan Model Astra ditunda karena risiko keamanan siber.';
  let fetchedUrls;
  let baseOptions;
  let verifierCalls = 0;
  const sourceFetcher = {
    validateSourceUrls: urls => urls,
    fetchSources: async urls => {
      fetchedUrls = urls;
      return [{ url: sourceUrl, finalUrl: sourceUrl, title: 'Laporan Astra', text: evidence, fetchedAt: '2026-08-08T00:00:00.000Z' }];
    },
    buildSourceContext: sources => `SOURCE 1\nCONTENT:\n${sources[0].text}`
  };
  const base = verifiedContent('Penundaan Pengembangan Model Astra');
  const candidateSlides = base.slides.map((slide, index) => ({
    ...slide,
    title: ['Konteks Artikel', 'Fokus Pembahasan', 'Detail Utama', 'Baca Konteks Lengkap'][index],
    body: index === 3 ? 'Periksa sumber lengkap sebelum menarik kesimpulan.' : 'Model Astra ditunda karena risiko keamanan siber.',
    claims: index === 3 ? [] : [{ field: `slide:${index}:body`, text: 'Model Astra ditunda karena risiko keamanan siber.', sourceId: 'source-1', evidence }]
  }));
  const content = {
    generateContent: async (_previousTopics, options) => {
      baseOptions = options;
      return base;
    },
    validateContent: () => []
  };
  const client = {
    chat: { completions: { create: async request => {
      verifierCalls += 1;
      const semanticAudit = /auditor entailment fakta/i.test(request.messages[1].content);
      return { choices: [{ message: { content: JSON.stringify(semanticAudit ? { unsupported: [] } : { slides: candidateSlides }) } }] };
    } } }
  };
  const sourceFilter = {
    generateFilteredContent: input => realSourceFilter.generateFilteredContent({ ...input, client })
  };

  const id = await generateAndSave({
    db,
    mode: 'ai',
    requestedTopic: '',
    useSources: true,
    sourceUrls: [sourceUrl],
    sourceFetcher,
    sourceFilter,
    content,
    images: fakeImages,
    useTrendReference: false
  });

  assert.deepEqual(fetchedUrls, [sourceUrl]);
  assert.equal(baseOptions.requestedTopic, undefined);
  assert.equal(baseOptions.useSources, true);
  assert.deepEqual(baseOptions.sources.map(source => source.url), [sourceUrl]);
  assert.match(baseOptions.sourceContext, /risiko keamanan siber/);
  assert.ok(verifierCalls >= 2, 'base source-aware tetap harus melewati verifier dan semantic audit nyata');
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Penundaan Pengembangan Model Astra');
  db.close();
});

test('Listicle AI + URL kaya fakta melewati generation, verifier, dan semantic audit secara penuh', async () => {
  const facts = [
    'Delapan model teratas berasal dari pengembang Asia.',
    'Model Aurora berada di posisi pertama.',
    'Aurora mencatat skor evaluasi 1243.',
    'Peringkat ditentukan melalui voting blind.',
    'Penilai membandingkan dua video dari prompt yang sama.'
  ];
  const source = { url: 'https://example.test/model-ranking', text: facts.join(' ') };
  const bodies = [
    'Delapan model teratas berasal dari pengembang Asia.',
    'Model Aurora menempati posisi pertama.',
    'Skor evaluasi Aurora tercatat 1243.',
    'Voting blind menentukan susunan peringkat.',
    'Dua video dibandingkan dari prompt yang sama.'
  ];
  const initialSlides = bodies.map((body, index) => ({
    section: index === 0 ? 'PEMBUKA' : index === 4 ? 'PENUTUP' : `ITEM ${index + 1}`,
    title: ['Peta Persaingan', 'Pemimpin Peringkat', 'Skor Evaluasi', 'Metode Penilaian', 'Perbandingan Setara'][index],
    body,
    points: [],
    claims: [{ text: body, sourceId: 'source-1', evidence: facts[index] }]
  }));
  const initial = {
    focus: { masalah: 'Memahami peringkat', penyebab: 'Fakta tersebar', solusi: 'Merangkum fakta', hasil: 'Konteks lebih jelas' },
    topic: 'Peringkat model video', hook: initialSlides[0].title, body: bodies[0], caption: bodies[0], hashtags: [],
    cta: initialSlides.at(-1).title, trendKeywordsUsed: [], content_angle: 'peringkat model', primary_tool: 'tanpa tool',
    hook_pattern: 'listicle', verificationStatus: 'source_based', unsupportedClaims: [], slides: initialSlides
  };
  const verifiedSlides = initialSlides.map((slide, slideIndex) => ({
    ...slide,
    claims: slide.claims.map(claim => ({ ...claim, field: `slide:${slideIndex}:body` }))
  }));
  let initialCalls = 0;
  let verifierCalls = 0;
  let auditCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      auditCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    if (/FILTER\/VERIFIER fakta/i.test(prompt)) {
      verifierCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ slides: verifiedSlides }) } }] };
    }
    initialCalls += 1;
    assert.match(prompt, /Tentukan sendiri SATU topik utama.*FACT_BANK/s);
    assert.match(prompt, /Gunakan 4–5 slide Listicle/);
    return { choices: [{ message: { content: JSON.stringify(initial) } }] };
  } } } };

  const output = await realSourceFilter.generateFilteredContent({
    content: realContent,
    options: { topicSource: 'ai', useSources: true, contentFormat: 'Listicle', sourceContext: source.text },
    sources: [source],
    client
  });

  assert.equal(initialCalls, 1, 'pipeline harus memulai dari source-aware generation nyata');
  assert.equal(verifierCalls, 1, 'hasil generation harus melewati verifier nyata');
  assert.equal(auditCalls, 1, 'hasil verifier harus melewati semantic audit');
  assert.ok(output.slides.length >= 4 && output.slides.length <= 5);
  assert.ok(output.slides.every(slide => slide.body || slide.points.length), 'tidak boleh ada slide title-only');
  assert.equal(new Set(output.slides.map(slide => slide.body)).size, 5, 'beberapa fakta berbeda harus dipertahankan');
  assert.doesNotMatch(JSON.stringify(output.slides), /Data berasal dari sumber|Baca sumber lengkap/i);
  assert.deepEqual(output.slides.flatMap(slide => slide.claims.map(claim => claim.evidence)), facts);
});

test('AI tanpa URL dan trending tetap tidak mengambil sumber', async () => {
  for (const mode of ['ai', 'trending']) {
    const db = createDatabase(':memory:');
    let fetchCalls = 0;
    let generationOptions;
    const sourceFetcher = { fetchSources: async () => { fetchCalls += 1; throw new Error('tidak boleh dipanggil'); } };
    const content = { generateContent: async (topics, options) => { generationOptions = options; return verifiedContent(options.requestedTopic || 'Topik AI tanpa sumber'); } };
    await generateAndSave({
      db,
      mode,
      useSources: mode === 'trending',
      sourceUrls: ['https://example.com/tersimpan'],
      sourceFetcher,
      content,
      trending: { getLatest: async () => ['Topik trending tetap'] },
      images: fakeImages,
      useTrendReference: false
    });
    assert.equal(fetchCalls, 0);
    assert.equal(generationOptions.useSources, false);
    assert.deepEqual(generationOptions.sources, []);
    assert.equal(generationOptions.sourceContext, '');
    db.close();
  }
});
