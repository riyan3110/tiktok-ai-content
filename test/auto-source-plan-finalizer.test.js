const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const qualityLayer = require('../src/services/autoSourceQualityLayer');
const runtimeGuard = require('../src/services/autoSourceRuntimeGuard');
const planFinalizer = require('../src/services/autoSourcePlanFinalizer');

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
      evidence: evidence[Math.min(pointIndex + 1, evidence.length - 1)]
    }))
  ];
}

const slideFixtures = [
  {
    title: 'Gemini dan input multimodal',
    body: 'Gemini menyediakan fitur multimodal untuk memahami teks gambar dan audio.',
    points: ['Terintegrasi dengan Google Workspace', 'Mendukung konteks percakapan panjang']
  },
  {
    title: 'Gemini untuk ringkasan dokumen',
    body: 'Gemini membantu pengguna merangkum dokumen panjang secara langsung di aplikasi.',
    points: ['Dapat menganalisis gambar dari kamera']
  },
  {
    title: 'Gemini untuk penulisan',
    body: 'Gemini menghadirkan fitur untuk membantu pengguna menulis dan menyunting teks.',
    points: ['Mendukung analisis file yang diunggah', 'Menyediakan bantuan penulisan dalam aplikasi']
  },
  {
    title: 'Gemini dalam percakapan',
    body: 'Gemini memungkinkan pengguna mencari informasi dengan konteks percakapan yang berkelanjutan.',
    points: []
  }
];

test('plan-first assigns one publisher/source owner per slide and uses all selected sources', () => {
  const facts = planFinalizer.ensureEverySourceHasFacts(sources, 'Aplikasi Gemini');
  const context = planFinalizer.planContext({ sources, facts, sections });
  assert.deepEqual(context.slides.map(slide => slide.primarySourceId), ['source-1', 'source-2', 'source-3', 'source-4']);
  assert.ok(context.slides.every(slide => slide.evidence.length >= 1));
});

test('information density allows variable bullet counts when body remains factual and substantial', () => {
  const content = {
    slides: slideFixtures.map((fixture, index) => ({ section: sections[index], ...fixture }))
  };
  assert.deepEqual(planFinalizer.informationDensityErrors(content), []);
});

test('thin copy is rejected by information density without requiring a fixed bullet count', () => {
  const content = {
    slides: [{ title: 'Gemini terbaru', body: 'Gemini punya fitur baru.', points: [] }]
  };
  const errors = planFinalizer.informationDensityErrors(content);
  assert.ok(errors.some(error => /isi terlalu tipis|body harus/i.test(error)));
  assert.ok(errors.every(error => !/membutuhkan 3 bullet|tepat 3 bullet/i.test(error)));
});

test('redundant point is removed instead of blocking the whole carousel', () => {
  const body = 'Gemini mendukung percakapan suara langsung melalui aplikasi untuk membantu interaksi pengguna.';
  const content = {
    slides: [{
      section: 'FAKTA UTAMA',
      title: 'Gemini mendukung percakapan suara',
      body,
      points: ['Gemini mendukung percakapan suara', 'Tersedia melalui aplikasi seluler resmi'],
      claims: [
        { field: 'slide:0:body', text: 'teks lama', sourceId: 'source-1', evidence: sources[0].text.split('. ')[0] },
        { field: 'slide:0:point:0', text: 'teks lama', sourceId: 'source-1', evidence: 'Gemini mendukung percakapan melalui suara langsung.' },
        { field: 'slide:0:point:1', text: 'teks lama', sourceId: 'source-1', evidence: 'Gemini tersedia melalui aplikasi seluler resmi.' }
      ]
    }]
  };
  const cleaned = planFinalizer.removeRedundantPoints(content);
  assert.deepEqual(cleaned.slides[0].points, ['Tersedia melalui aplikasi seluler resmi']);
  assert.equal(cleaned.slides[0].claims.find(claim => claim.field === 'slide:0:body').text, body);
  assert.equal(cleaned.slides[0].claims.find(claim => claim.field === 'slide:0:point:0').text, 'Tersedia melalui aplikasi seluler resmi');
});

test('claim text is synchronized to final visible copy before validation', () => {
  const content = {
    slides: [{
      title: 'Gemini membantu pengguna',
      body: 'Gemini membantu pengguna merangkum dokumen panjang langsung melalui aplikasi resmi.',
      points: ['Mendukung analisis file pengguna'],
      claims: [
        { field: 'slide:0:body', text: 'draft body lama', sourceId: 'source-1', evidence: 'Gemini membantu pengguna merangkum dokumen panjang secara langsung di aplikasi.' },
        { field: 'slide:0:point:0', text: 'draft point lama', sourceId: 'source-1', evidence: 'Gemini mendukung analisis file yang diunggah.' }
      ]
    }]
  };
  const synced = planFinalizer.synchronizeClaims(content);
  assert.equal(synced.slides[0].claims[0].text, synced.slides[0].body);
  assert.equal(synced.slides[0].claims[1].text, synced.slides[0].points[0]);
});

test('plan ownership rejects mixed source claims before final output', () => {
  const facts = planFinalizer.ensureEverySourceHasFacts(sources, 'Aplikasi Gemini');
  const context = planFinalizer.planContext({ sources, facts, sections });
  const mixed = {
    slides: slideFixtures.map((fixture, index) => ({
      section: sections[index],
      ...fixture,
      claims: claimsForSlide(index, index, fixture.body, fixture.points, [fixture.body, ...fixture.points, fixture.body])
    }))
  };
  mixed.slides[0].claims[1].sourceId = 'source-2';
  const errors = planFinalizer.planOwnershipErrors(mixed, context);
  assert.ok(errors.some(error => error.includes('wajib source-1, bukan source-2')));
});

test('plan ownership permits one source sentence to support different visible facts', () => {
  const facts = planFinalizer.ensureEverySourceHasFacts(sources, 'Aplikasi Gemini');
  const context = planFinalizer.planContext({ sources, facts, sections });
  const evidence = context.slides[0].evidence[0];
  const content = {
    slides: [{
      title: 'Gemini multimodal',
      body: 'Gemini memahami beberapa jenis masukan dalam pengalaman penggunaan aplikasi.',
      points: ['Mendukung teks gambar dan audio'],
      claims: [
        { field: 'slide:0:body', text: 'Gemini memahami beberapa jenis masukan dalam pengalaman penggunaan aplikasi.', sourceId: 'source-1', evidence },
        { field: 'slide:0:point:0', text: 'Mendukung teks gambar dan audio', sourceId: 'source-1', evidence }
      ]
    }]
  };
  const oneSlideContext = { slides: [context.slides[0]] };
  assert.deepEqual(planFinalizer.planOwnershipErrors(content, oneSlideContext), []);
});

test('plan-first prompt treats Muse example as density guidance, not a three-bullet quota', () => {
  const facts = planFinalizer.ensureEverySourceHasFacts(sources, 'Aplikasi Gemini');
  const context = planFinalizer.planContext({ sources, facts, sections });
  const text = planFinalizer.prompt({
    topic: 'Aplikasi Gemini',
    format: 'Fakta singkat',
    context,
    errors: [],
    previousSlides: []
  });
  assert.match(text, /Bullet TIDAK WAJIB berjumlah 3/i);
  assert.match(text, /0-3 bullet/i);
  assert.match(text, /contoh KEPADATAN INFORMASI, bukan kewajiban jumlah bullet/i);
  assert.doesNotMatch(text, /SETIAP slide wajib tepat 3 bullet/i);
});
