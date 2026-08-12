const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const sourceFilter = require('../src/services/sourceFilter');
const finalizer = require('../src/services/sourceUrlFinalizer');

function indonesianSource() {
  return [{
    url: 'https://example.test/artikel',
    finalUrl: 'https://example.test/artikel',
    title: 'AI Mengubah Cara Mahasiswa Belajar',
    text: [
      'AI membantu mahasiswa mencari penjelasan tambahan ketika memahami materi kuliah yang sulit.',
      'Dosen tetap berperan penting untuk memberi konteks dan memeriksa kualitas jawaban mahasiswa.',
      'Mahasiswa dapat memakai AI untuk merangkum bahan belajar sebelum membahasnya kembali di kelas.',
      'Penggunaan AI perlu disertai pemeriksaan sumber agar informasi yang dipakai tetap dapat dipertanggungjawabkan.',
      'Kampus mendorong mahasiswa memahami cara kerja alat AI dan batas kemampuan model yang digunakan.',
      'Diskusi kelas tetap dibutuhkan karena proses belajar tidak hanya bergantung pada jawaban otomatis.',
      'Pengajar dapat menyesuaikan tugas agar mahasiswa menjelaskan alasan di balik jawaban yang mereka buat.',
      'Literasi AI menjadi bagian penting ketika teknologi semakin sering digunakan dalam kegiatan akademik.'
    ].join(' ')
  }];
}

function candidate() {
  const rows = [
    ['PEMBUKA', 'AI Masuk Cara Belajar', 'AI membantu mahasiswa mencari penjelasan tambahan saat memahami materi kuliah yang sulit.', 'AI membantu mahasiswa mencari penjelasan tambahan ketika memahami materi kuliah yang sulit.'],
    ['FAKTA UTAMA', 'Dosen Tetap Penting', 'Dosen tetap berperan penting dalam memberi konteks dan memeriksa kualitas jawaban mahasiswa.', 'Dosen tetap berperan penting untuk memberi konteks dan memeriksa kualitas jawaban mahasiswa.'],
    ['KONTEKS', 'Sumber Tetap Perlu Dicek', 'Penggunaan AI perlu disertai pemeriksaan sumber agar informasi tetap dapat dipertanggungjawabkan.', 'Penggunaan AI perlu disertai pemeriksaan sumber agar informasi yang dipakai tetap dapat dipertanggungjawabkan.'],
    ['KESIMPULAN', 'Literasi AI Makin Penting', 'Literasi AI menjadi penting ketika teknologi semakin sering digunakan dalam kegiatan akademik.', 'Literasi AI menjadi bagian penting ketika teknologi semakin sering digunakan dalam kegiatan akademik.']
  ];
  const slides = rows.map((row, index) => ({
    section: row[0],
    title: row[1],
    body: row[2],
    points: [],
    claims: [{ field: `slide:${index}:body`, text: row[2], sourceId: 'source-1', evidence: row[3] }]
  }));
  return {
    topic: 'AI Ubah Cara Mahasiswa Belajar',
    effectiveContentFormat: 'Fakta singkat',
    hook: slides[0].title,
    body: slides[1].body,
    caption: slides[1].body,
    cta: slides.at(-1).title,
    hashtags: [],
    verificationStatus: 'source_based',
    slides
  };
}

function responseFor(content) {
  return { choices: [{ message: { content: JSON.stringify({ slides: content.slides }) } }] };
}

function clientWith(response) {
  let calls = 0;
  return {
    get calls() { return calls; },
    chat: { completions: { create: async () => { calls += 1; return response; } } }
  };
}

function patchSemanticAudit(t, value = []) {
  const original = sourceFilter.auditClaimSemantics;
  sourceFilter.auditClaimSemantics = async () => value;
  t.after(() => { sourceFilter.auditClaimSemantics = original; });
}

test('Pakai URL hanya melakukan satu final AI pass', async t => {
  patchSemanticAudit(t);
  const valid = candidate();
  const client = clientWith(responseFor(valid));
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: valid,
    sources: indonesianSource(),
    topic: valid.topic,
    format: 'Fakta singkat',
    client
  });
  assert.equal(finalizer.MAX_FINALIZE_ATTEMPTS, 1);
  assert.equal(client.calls, 1);
  assert.equal(result.slides.length, 4);
});

test('provider output kosong tidak memicu retry panjang dan langsung memakai source-only fallback', async t => {
  patchSemanticAudit(t);
  const valid = candidate();
  const client = clientWith({ choices: [{ message: { content: '' } }] });
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: valid,
    sources: indonesianSource(),
    topic: valid.topic,
    format: 'Fakta singkat',
    client
  });
  assert.equal(client.calls, 1);
  assert.equal(result.verificationStatus, 'source_based');
  assert.ok(result.slides.length >= 4);
  assert.equal(result.__deterministicSourceFallback, true);
});

test('fenced JSON dan textual content array tetap dapat diparse', () => {
  const valid = candidate();
  const sections = valid.slides.map(slide => slide.section);
  const fenced = { choices: [{ message: { content: `\n\`\`\`json\n${JSON.stringify({ slides: valid.slides })}\n\`\`\`\n` } }] };
  const array = { choices: [{ message: { content: [{ type: 'text', text: JSON.stringify({ slides: valid.slides }) }] } }] };
  assert.deepEqual(finalizer.parseSlides(fenced, sections), valid.slides);
  assert.deepEqual(finalizer.parseSlides(array, sections), valid.slides);
});

test('finalizer URL tidak lagi memiliki exact numeric hard-gate tambahan dari PR #155', async t => {
  const originalValidate = sourceFilter.validateVerifiedContent;
  const originalAudit = sourceFilter.auditClaimSemantics;
  sourceFilter.validateVerifiedContent = content => ({ content, errors: [] });
  sourceFilter.auditClaimSemantics = async () => [];
  t.after(() => {
    sourceFilter.validateVerifiedContent = originalValidate;
    sourceFilter.auditClaimSemantics = originalAudit;
  });

  const source = indonesianSource();
  source[0].text += ' Hal tersebut disampaikan di hadapan lebih dari 10.000 mahasiswa baru dalam perhelatan kampus.';
  const valid = candidate();
  valid.slides[0].body = 'Lebih dari 10 ribu mahasiswa baru hadir dalam perhelatan kampus tersebut.';
  valid.slides[0].claims[0] = {
    field: 'slide:0:body',
    text: valid.slides[0].body,
    sourceId: 'source-1',
    evidence: 'Hal tersebut disampaikan di hadapan lebih dari 10.000 mahasiswa baru dalam perhelatan kampus.'
  };
  const client = clientWith(responseFor(valid));
  const result = await finalizer.rewriteAllSourcesWithAi({ generated: valid, sources: source, topic: valid.topic, format: 'Fakta singkat', client });
  assert.equal(client.calls, 1);
  assert.equal(result.slides[0].body, valid.slides[0].body);
  assert.equal(typeof finalizer.numericGroundingErrors, 'undefined');
});
