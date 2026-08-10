const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const realContent = require('../src/services/content');
const { generateFilteredContent, MAX_VERIFY_ATTEMPTS } = require('../src/services/sourceFilter');

const facts = [
  'Model Orion menggunakan evaluasi blind untuk membandingkan hasil video.',
  'Penilai memilih hasil terbaik tanpa mengetahui nama model pembuatnya.',
  'Hasil evaluasi dicatat setelah seluruh penilai menyelesaikan perbandingan.',
  'Laporan menjelaskan metode evaluasi dan konteks hasil pengujian model.'
];
const source = { url: 'https://example.test/orion', text: facts.join(' ') };

function verifiedSlides() {
  const titles = ['Metode Evaluasi', 'Proses Penilaian', 'Pencatatan Hasil', 'Catatan Akhir'];
  return facts.map((fact, index) => ({
    section: index === 0 ? 'PEMBUKA' : index === facts.length - 1 ? 'PENUTUP' : `ITEM ${index}`,
    title: titles[index],
    body: fact,
    points: [],
    claims: [{ field: `slide:${index}:body`, text: fact, sourceId: 'source-1', evidence: fact }]
  }));
}

function bootstrap(overrides = {}) {
  const slides = verifiedSlides();
  return {
    focus: {
      masalah: facts[0],
      penyebab: facts[1],
      solusi: facts[2],
      hasil: facts[3]
    },
    topic: 'Model Orion',
    hook: slides[0].title,
    body: slides[0].body,
    caption: slides[0].body,
    hashtags: [],
    cta: slides.at(-1).title,
    trendKeywordsUsed: [],
    content_angle: 'evaluasi model',
    primary_tool: 'Orion',
    hook_pattern: 'langsung',
    verificationStatus: 'source_based',
    unsupportedClaims: [],
    slides,
    ...overrides
  };
}

function clientFor(slides, counters) {
  return { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      counters.audit += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    counters.verify += 1;
    return { choices: [{ message: { content: JSON.stringify({ slides }) } }] };
  } } } };
}

function contentService(base, finalGroundingCalls) {
  return {
    async generateContent(_previous, options) {
      assert.equal(options.useSources, true, 'bootstrap harus tetap membaca source');
      assert.equal(options.deferSourceGroundingValidation, true, 'grounding hanya ditunda pada bootstrap');
      return base;
    },
    validateContent: realContent.validateContent,
    validateSourceGrounding(value, sourceContext, sources) {
      finalGroundingCalls.push(value);
      return realContent.validateSourceGrounding(value, sourceContext, sources);
    }
  };
}

test('final grounding menolak topic dan focus bootstrap unsupported walau seluruh slide verified', async () => {
  const slides = verifiedSlides();
  const base = bootstrap({
    topic: 'Model Orion dipakai 99 juta pengguna',
    focus: {
      masalah: 'Model Orion pasti gagal menjaga keamanan pengguna',
      penyebab: facts[1],
      solusi: facts[2],
      hasil: facts[3]
    }
  });
  const counters = { verify: 0, audit: 0 };
  const finalGroundingCalls = [];

  await assert.rejects(generateFilteredContent({
    content: contentService(base, finalGroundingCalls),
    options: { topicSource: 'ai', useSources: true, requestedTopic: '', contentFormat: 'Listicle', sourceContext: source.text },
    sources: [source],
    client: clientFor(slides, counters)
  }), error => {
    assert.equal(error.status, 422);
    assert.match(error.validationErrors.join(' '), /Pernyataan faktual wajib memiliki evidence.*99 juta pengguna/i);
    assert.match(error.validationErrors.join(' '), /FOCUS_MASALAH.*pasti gagal/i);
    return true;
  });

  assert.equal(counters.verify, MAX_VERIFY_ATTEMPTS);
  assert.equal(counters.audit, MAX_VERIFY_ATTEMPTS, 'setiap candidate slide valid mencapai final grounding setelah semantic audit');
  assert.equal(finalGroundingCalls.length, MAX_VERIFY_ATTEMPTS);
  assert.ok(finalGroundingCalls.every(value => value.verificationStatus === 'source_based'));
});

test('final grounding menerima topic dan focus source-aware yang didukung source', async () => {
  const slides = verifiedSlides();
  const base = bootstrap();
  const counters = { verify: 0, audit: 0 };
  const finalGroundingCalls = [];

  const result = await generateFilteredContent({
    content: contentService(base, finalGroundingCalls),
    options: { topicSource: 'ai', useSources: true, requestedTopic: '', contentFormat: 'Listicle', sourceContext: source.text },
    sources: [source],
    client: clientFor(slides, counters)
  });

  assert.equal(result.topic, 'Model Orion', 'topic yang ditentukan dari source harus dipertahankan');
  assert.deepEqual(result.focus, base.focus);
  assert.equal(result.verificationStatus, 'source_based');
  assert.equal(counters.verify, 1);
  assert.equal(counters.audit, 1);
  assert.equal(finalGroundingCalls.length, 1, 'hasil verified wajib melewati final source grounding tepat sebelum return');
  assert.deepEqual(realContent.validateSourceGrounding(result, source.text, [source]), []);
});
