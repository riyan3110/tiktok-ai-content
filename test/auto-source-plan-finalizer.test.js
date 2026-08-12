const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const qualityLayer = require('../src/services/autoSourceQualityLayer');
const runtimeGuard = require('../src/services/autoSourceRuntimeGuard');
const planFinalizer = require('../src/services/autoSourcePlanFinalizer');
const resilient = require('../src/services/autoSourceResilientFinalizer');

qualityLayer.install();
runtimeGuard.install();

const sources = [
  {
    title: 'Gemini mendukung input multimodal',
    text: [
      'Gemini menyediakan fitur multimodal untuk memahami teks gambar dan audio.',
      'Gemini terintegrasi dengan layanan Google Workspace.',
      'Gemini mendukung percakapan berbasis konteks panjang.',
      'Gemini tersedia melalui aplikasi seluler resmi.'
    ].join(' ')
  },
  {
    title: 'Gemini membantu ringkasan dokumen',
    text: [
      'Gemini membantu pengguna merangkum dokumen panjang secara langsung di aplikasi.',
      'Gemini dapat menganalisis gambar dari kamera.',
      'Gemini menyediakan jawaban berdasarkan konteks percakapan.',
      'Gemini mendukung masukan suara dalam aplikasi.'
    ].join(' ')
  },
  {
    title: 'Gemini mendukung penulisan',
    text: [
      'Gemini menghadirkan fitur untuk membantu pengguna menulis dan menyunting teks.',
      'Gemini dapat membuat ringkasan dari dokumen.',
      'Gemini mendukung analisis file yang diunggah.',
      'Gemini menyediakan bantuan penulisan dalam aplikasi.'
    ].join(' ')
  },
  {
    title: 'Gemini mendukung percakapan berkelanjutan',
    text: [
      'Gemini memungkinkan pengguna mencari informasi dengan konteks percakapan yang berkelanjutan.',
      'Gemini mendukung percakapan melalui suara langsung.',
      'Gemini dapat memahami gambar dalam percakapan.',
      'Gemini tersedia untuk pengguna perangkat seluler.'
    ].join(' ')
  }
];

const sections = ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'];

function claimsForSlide(slideIndex, sourceIndex, body, points, evidence) {
  return [
    { field: `slide:${slideIndex}:body`, text: body, sourceId: `source-${sourceIndex + 1}`, evidence: evidence[0] },
    ...points.map((point, pointIndex) => ({
      field: `slide:${slideIndex}:point:${pointIndex}`,
      text: point,
      sourceId: `source-${sourceIndex + 1}`,
      evidence: evidence[pointIndex + 1]
    }))
  ];
}

const slideFixtures = [
  {
    title: 'Gemini dan input multimodal',
    body: 'Gemini menyediakan fitur multimodal untuk memahami teks gambar dan audio.',
    points: [
      'Gemini terintegrasi dengan layanan Google Workspace.',
      'Gemini mendukung percakapan berbasis konteks panjang.',
      'Gemini tersedia melalui aplikasi seluler resmi.'
    ]
  },
  {
    title: 'Gemini untuk ringkasan dokumen',
    body: 'Gemini membantu pengguna merangkum dokumen panjang secara langsung di aplikasi.',
    points: [
      'Gemini dapat menganalisis gambar dari kamera.',
      'Gemini menyediakan jawaban berdasarkan konteks percakapan.',
      'Gemini mendukung masukan suara dalam aplikasi.'
    ]
  },
  {
    title: 'Gemini untuk penulisan',
    body: 'Gemini menghadirkan fitur untuk membantu pengguna menulis dan menyunting teks.',
    points: [
      'Gemini dapat membuat ringkasan dari dokumen.',
      'Gemini mendukung analisis file yang diunggah.',
      'Gemini menyediakan bantuan penulisan dalam aplikasi.'
    ]
  },
  {
    title: 'Gemini dalam percakapan',
    body: 'Gemini memungkinkan pengguna mencari informasi dengan konteks percakapan yang berkelanjutan.',
    points: [
      'Gemini mendukung percakapan melalui suara langsung.',
      'Gemini dapat memahami gambar dalam percakapan.',
      'Gemini tersedia untuk pengguna perangkat seluler.'
    ]
  }
];

test('plan-first assigns one publisher/source owner per slide and uses all selected sources', () => {
  const facts = planFinalizer.ensureEverySourceHasFacts(sources, 'Aplikasi Gemini');
  const context = planFinalizer.planContext({ sources, facts, sections });
  assert.equal(context.profile.targetPoints, 3);
  assert.deepEqual(context.slides.map(slide => slide.primarySourceId), ['source-1', 'source-2', 'source-3', 'source-4']);
  assert.ok(context.slides.every(slide => slide.evidence.length === 4));
});

test('a coherent dense Fakta singkat candidate passes pre-semantic Auto Source validation', () => {
  const facts = planFinalizer.ensureEverySourceHasFacts(sources, 'Aplikasi Gemini');
  const slides = slideFixtures.map((fixture, index) => ({
    section: sections[index],
    ...fixture,
    claims: claimsForSlide(index, index, fixture.body, fixture.points, [
      fixture.body,
      ...fixture.points
    ])
  }));
  const candidate = { topic: 'Aplikasi Gemini', slides };
  const result = resilient.validateCandidate({
    draft: candidate,
    sources,
    topic: 'Aplikasi Gemini',
    format: 'Fakta singkat',
    contentService: { validateContent: () => [] },
    facts
  });
  assert.deepEqual(result.errors, []);
});

test('plan ownership rejects mixed source claims before final output', () => {
  const facts = planFinalizer.ensureEverySourceHasFacts(sources, 'Aplikasi Gemini');
  const context = planFinalizer.planContext({ sources, facts, sections });
  const mixed = {
    slides: slideFixtures.map((fixture, index) => ({
      section: sections[index],
      ...fixture,
      claims: claimsForSlide(index, index, fixture.body, fixture.points, [fixture.body, ...fixture.points])
    }))
  };
  mixed.slides[0].claims[1].sourceId = 'source-2';
  const errors = planFinalizer.planOwnershipErrors(mixed, context);
  assert.ok(errors.some(error => error.includes('wajib source-1, bukan source-2')));
});

test('plan-first prompt requires full-slide rebuild instead of field-only repair', () => {
  const facts = planFinalizer.ensureEverySourceHasFacts(sources, 'Aplikasi Gemini');
  const context = planFinalizer.planContext({ sources, facts, sections });
  const text = planFinalizer.prompt({
    topic: 'Aplikasi Gemini',
    format: 'Fakta singkat',
    context,
    errors: ['AUTO_SOURCE_DENSITY: slide:0 membutuhkan 3 bullet; baru ada 2'],
    previousSlides: []
  });
  assert.match(text, /Bangun ulang SEMUA slide/i);
  assert.match(text, /SATU SLIDE = SATU primarySourceId/i);
  assert.match(text, /SETIAP slide wajib tepat 3 bullet fakta berbeda/i);
});
