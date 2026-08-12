const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/sourceUrlFinalizer');

test('compat structural title tetap deklaratif tetapi bukan jalur hasil final', () => {
  const sections = ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'];
  const titles = sections.map((section, index) => finalizer.structuralTitle(section, 'AI dalam Nasihat Keuangan', index));
  titles.forEach(title => assert.doesNotMatch(title, /\?/));
  assert.equal(new Set(titles).size, titles.length);
});

test('title error direpair dari evidence body tanpa template section dan tanpa mengubah body/bullet', () => {
  const evidence = 'AI digunakan sebagian orang untuk mencari informasi tentang layanan keuangan dan membandingkan pilihan yang tersedia.';
  const content = {
    slides: [{
      section: 'FAKTA UTAMA',
      title: 'AI dalam Nasihat Keuangan: Fakta Utama',
      body: 'AI digunakan sebagian orang untuk mencari informasi tentang layanan keuangan dan membandingkan pilihan yang tersedia.',
      points: ['Sumber tetap perlu diperiksa', 'Nasihat profesional masih digunakan', 'Risiko hukum perlu dipahami'],
      claims: [
        { field: 'slide:0:title', text: 'AI dalam Nasihat Keuangan: Fakta Utama', sourceId: 'source-1', evidence },
        { field: 'slide:0:body', text: 'AI digunakan sebagian orang untuk mencari informasi tentang layanan keuangan dan membandingkan pilihan yang tersedia.', sourceId: 'source-1', evidence }
      ]
    }]
  };
  const repaired = finalizer.repairProblematicTitles(content, ['slide:0:title:natural: judul template berulang dilarang.']);
  assert.equal(repaired.changed, true);
  assert.equal(repaired.content.slides[0].body, content.slides[0].body);
  assert.deepEqual(repaired.content.slides[0].points, content.slides[0].points);
  assert.notEqual(repaired.content.slides[0].title, content.slides[0].title);
  assert.doesNotMatch(repaired.content.slides[0].title, /:\s*Fakta Utama$/i);
  const titleClaim = repaired.content.slides[0].claims.find(claim => claim.field === 'slide:0:title');
  assert.ok(titleClaim);
  assert.equal(titleClaim.text, repaired.content.slides[0].title);
  assert.equal(titleClaim.sourceId, 'source-1');
  assert.equal(titleClaim.evidence, evidence);
});

test('relevance bank mempertahankan context window dekat topik dan membuang blok jauh', () => {
  const sources = [{ title: 'AI dalam Nasihat Keuangan', text: 'fixture only' }];
  const facts = Array.from({ length: 20 }, (_, index) => ({
    sourceId: 'source-1',
    evidence: index === 2 || index === 5 || index === 8
      ? `AI dan nasihat keuangan dibahas pada fakta utama bagian ${index}.`
      : index >= 15
        ? `Blok artikel lain membahas pertandingan olahraga nomor ${index}.`
        : `Konteks pendukung nasihat keuangan berada pada bagian artikel ${index}.`
  }));
  const selected = finalizer.relevantSourceFacts(sources, facts, 'AI dalam Nasihat Keuangan');
  const text = selected.map(fact => fact.evidence).join(' ');
  assert.match(text, /Konteks pendukung nasihat keuangan/);
  assert.doesNotMatch(text, /pertandingan olahraga/);
  assert.ok(selected.length >= 7);
});

test('source kaya mewajibkan tiga bullet per slide pada pass AI ketat', () => {
  const facts = Array.from({ length: 16 }, (_, index) => ({ sourceId: 'source-1', evidence: `Fakta ${index + 1} berbeda dan didukung sumber utama.` }));
  const sparse = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Judul Fakta ${index + 1}`,
      body: 'Body faktual yang cukup panjang untuk menjelaskan konteks sumber secara natural.',
      points: ['Satu fakta tambahan saja']
    }))
  };
  assert.equal(finalizer.urlDensityErrors(sparse, facts).length, 4);
  sparse.slides.forEach(slide => { slide.points = ['Fakta tambahan pertama', 'Fakta tambahan kedua', 'Fakta tambahan ketiga']; });
  assert.equal(finalizer.urlDensityErrors(sparse, facts).length, 0);
});

test('prompt Pakai URL meminta natural title, semua source, body panjang, dan tiga bullet saat source kaya', () => {
  const sources = [{
    url: 'https://example.test/a',
    finalUrl: 'https://example.test/a',
    title: 'Topik Utama',
    text: Array.from({ length: 18 }, (_, index) => `Fakta sumber ${index + 1} menjelaskan konteks penting yang berbeda untuk artikel utama.`).join(' ')
  }];
  const facts = Array.from({ length: 16 }, (_, index) => ({ sourceId: 'source-1', evidence: `Fakta sumber ${index + 1} menjelaskan konteks penting yang berbeda untuk artikel utama.` }));
  const prompt = finalizer.finalizerPrompt({
    generated: { slides: ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'].map(section => ({ section })) },
    sources,
    facts,
    format: 'Fakta singkat',
    topic: 'Topik Utama',
    errors: []
  });
  assert.match(prompt, /Judul harus natural dan spesifik/i);
  assert.match(prompt, /Jangan memakai pola berulang/i);
  assert.match(prompt, /BODY WAJIB minimal 10 kata/i);
  assert.match(prompt, /3 bullet fakta berbeda/i);
  assert.match(prompt, /SETIAP sourceId yang tercantum WAJIB/i);
  assert.match(prompt, /related article/i);
  assert.match(prompt, /dateline/i);
});
