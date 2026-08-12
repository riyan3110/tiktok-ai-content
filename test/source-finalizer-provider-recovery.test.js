const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const sourceFilter = require('../src/services/sourceFilter');
const finalizer = require('../src/services/sourceUrlFinalizer');

function englishSource() {
  return [{
    url: 'https://example.test/atlas-device',
    finalUrl: 'https://example.test/atlas-device',
    title: 'Atlas Device Profile Study',
    text: [
      'The Atlas device supports local profiles for shared workstations.',
      'Administrators can disable background synchronization when required.',
      'The device stores preferences locally between work sessions.',
      'Operators may export configuration records for later review.',
      'The control panel shows profile status without opening another screen.',
      'The team plans to publish migration guidance next quarter.',
      'Tests associated the cache setting with shorter startup time.',
      'The device can reduce memory use when several panels remain open.'
    ].join(' ')
  }];
}

function indonesianSource() {
  return [{
    url: 'https://example.test/mahasiswa-ai',
    finalUrl: 'https://example.test/mahasiswa-ai',
    title: 'AI Ubah Cara Mahasiswa Belajar',
    text: [
      'AI mulai dipakai mahasiswa untuk membantu memahami materi dan mencari penjelasan tambahan.',
      'Dosen tetap berperan untuk memberi konteks dan memeriksa kualitas jawaban mahasiswa.',
      'Hal tersebut disampaikan di hadapan lebih dari 10.000 mahasiswa baru Universitas Padjadjaran dalam perhelatan kampus.',
      'Mahasiswa juga diingatkan untuk memeriksa kembali sumber sebelum memakai informasi dari AI.',
      'Penggunaan AI di kampus perlu disertai literasi digital agar mahasiswa memahami batas kemampuan model.',
      'Diskusi dengan dosen tetap dibutuhkan karena proses belajar tidak hanya bergantung pada jawaban otomatis.',
      'Mahasiswa dapat menggunakan AI sebagai alat bantu dan bukan sebagai pengganti proses berpikir.',
      'Kampus mendorong penggunaan teknologi yang tetap memperhatikan tanggung jawab akademik.'
    ].join(' ')
  }];
}

function candidate(format = 'Fakta singkat', firstBody = 'Perangkat Atlas mendukung profil lokal untuk workstation yang digunakan bersama.') {
  const sections = format === 'Listicle'
    ? ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4']
    : ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'];
  const rows = [
    [firstBody, 'Profil lokal tersedia untuk workstation', 'The Atlas device supports local profiles for shared workstations.', 'Sinkronisasi latar dapat dinonaktifkan', 'Administrators can disable background synchronization when required.'],
    ['Perangkat menyimpan preferensi secara lokal di antara sesi kerja pengguna.', 'Catatan konfigurasi dapat diekspor', 'The device stores preferences locally between work sessions.', 'Ekspor tersedia untuk peninjauan', 'Operators may export configuration records for later review.'],
    ['Panel kontrol menampilkan status profil tanpa perlu membuka layar lainnya.', 'Status terlihat pada panel kontrol', 'The control panel shows profile status without opening another screen.', 'Panduan migrasi masih direncanakan', 'The team plans to publish migration guidance next quarter.'],
    ['Pengujian mengaitkan pengaturan cache dengan waktu mulai yang lebih singkat.', 'Memori dapat berkurang saat panel terbuka', 'Tests associated the cache setting with shorter startup time.', 'Penggunaan memori dapat dikurangi', 'The device can reduce memory use when several panels remain open.']
  ];
  const slides = rows.map((row, index) => ({
    section: sections[index],
    title: ['Profil Lokal Atlas', 'Preferensi Tetap Tersimpan', 'Status Mudah Dilihat', 'Cache dan Waktu Mulai'][index],
    body: row[0],
    points: [row[1]],
    claims: [
      { field: `slide:${index}:body`, text: row[0], sourceId: 'source-1', evidence: row[2] },
      { field: `slide:${index}:point:0`, text: row[1], sourceId: 'source-1', evidence: row[4] }
    ]
  }));
  return {
    topic: 'Atlas Device', effectiveContentFormat: format,
    hook: slides[0].title, body: slides[1].body, caption: slides[1].body,
    cta: slides.at(-1).title, hashtags: [], verificationStatus: 'source_based', slides
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

async function withoutSemanticProvider(t) {
  const original = sourceFilter.auditClaimSemantics;
  sourceFilter.auditClaimSemantics = async () => [];
  t.after(() => { sourceFilter.auditClaimSemantics = original; });
}

for (const format of ['Fakta singkat', 'Listicle']) {
  test(`${format}: provider valid selesai dalam satu final rewrite`, async t => {
    await withoutSemanticProvider(t);
    const valid = candidate(format);
    const client = clientWith(responseFor(valid));
    const result = await finalizer.rewriteAllSourcesWithAi({
      generated: valid, sources: englishSource(), topic: 'Atlas Device', format, client
    });
    assert.deepEqual(result.slides, valid.slides);
    assert.equal(client.calls, 1);
    assert.equal(finalizer.FAST_FINALIZE_ATTEMPTS, 1);
  });
}

test('provider output kosong langsung memakai source-only fallback tanpa retry panjang', async t => {
  await withoutSemanticProvider(t);
  const valid = candidate();
  const client = clientWith({ choices: [{ message: { content: '' } }] });
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: valid, sources: englishSource(), topic: 'Atlas Device', format: 'Fakta singkat', client
  });
  assert.equal(client.calls, 1);
  assert.equal(result.verificationStatus, 'source_based');
  assert.equal(result.__urlSourceFallback, true);
  assert.ok(result.slides.length >= 4);
});

test('malformed JSON langsung memakai source-only fallback tanpa request AI kedua', async t => {
  await withoutSemanticProvider(t);
  const valid = candidate();
  const client = clientWith({ choices: [{ message: { content: '```json\n{"slides": [ broken\n```' } }] });
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: valid, sources: englishSource(), topic: 'Atlas Device', format: 'Fakta singkat', client
  });
  assert.equal(client.calls, 1);
  assert.equal(result.__urlSourceFallback, true);
  assert.equal(result.verificationStatus, 'source_based');
});

test('numeric mismatch seperti 10 ribuan tidak mematikan konten URL', async t => {
  await withoutSemanticProvider(t);
  const base = candidate();
  const bad = {
    ...base,
    topic: 'AI Ubah Cara Mahasiswa Belajar',
    slides: base.slides.map((slide, index) => ({ ...slide, claims: slide.claims.map(claim => ({ ...claim })) }))
  };
  bad.slides[0].body = '10 ribuan mahasiswa hadir dalam perhelatan kampus tersebut.';
  bad.slides[0].claims[0] = {
    field: 'slide:0:body',
    text: bad.slides[0].body,
    sourceId: 'source-1',
    evidence: 'Hal tersebut disampaikan di hadapan lebih dari 10.000 mahasiswa baru Universitas Padjadjaran dalam perhelatan kampus.'
  };
  const client = clientWith(responseFor(bad));
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: bad,
    sources: indonesianSource(),
    topic: 'AI Ubah Cara Mahasiswa Belajar',
    format: 'Fakta singkat',
    client
  });
  assert.equal(client.calls, 1);
  assert.equal(result.__urlSourceFallback, true);
  assert.equal(result.verificationStatus, 'source_based');
  assert.equal(JSON.stringify(result.slides).includes('10 ribuan mahasiswa hadir'), false);
  assert.equal(finalizer.numericGroundingErrors(result).length, 0);
});

test('semantic rejection langsung turun ke source-only fallback', async t => {
  const original = sourceFilter.auditClaimSemantics;
  sourceFilter.auditClaimSemantics = async () => ['SEMANTIC_SUPPORT: slide:0:body tidak didukung evidence'];
  t.after(() => { sourceFilter.auditClaimSemantics = original; });
  const valid = candidate();
  const client = clientWith(responseFor(valid));
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: valid, sources: englishSource(), topic: 'Atlas Device', format: 'Fakta singkat', client
  });
  assert.equal(client.calls, 1);
  assert.equal(result.__urlSourceFallback, true);
  assert.equal(result.verificationStatus, 'source_based');
});

test('fenced JSON valid dinormalisasi secara terbatas', () => {
  const valid = candidate();
  const response = { choices: [{ message: { content: `\n\`\`\`json\n${JSON.stringify({ slides: valid.slides })}\n\`\`\`\n` } }] };
  assert.deepEqual(finalizer.parseSlides(response, valid.slides.map(slide => slide.section)), valid.slides);
});

test('content array text valid dinormalisasi secara terbatas', () => {
  const valid = candidate();
  const response = { choices: [{ message: { content: [{ type: 'text', text: JSON.stringify({ slides: valid.slides }) }] } }] };
  assert.deepEqual(finalizer.parseSlides(response, valid.slides.map(slide => slide.section)), valid.slides);
});

test('object JSON yang sudah parsed diterima hanya bila shape slides valid', () => {
  const valid = candidate();
  const response = { choices: [{ message: { content: { slides: valid.slides } } }] };
  assert.deepEqual(finalizer.parseSlides(response, valid.slides.map(slide => slide.section)), valid.slides);
  assert.throws(
    () => finalizer.parseSlides({ choices: [{ message: { content: { unexpected: true } } }] }, valid.slides.map(slide => slide.section)),
    /jumlah slide|shape|slides/i
  );
});

test('numeric dan ordinal grounding tetap menolak angka baru', () => {
  const checks = [
    ['Perangkat mendukung 14 profil.', 'Perangkat mendukung 14 profil.', true],
    ['Perangkat mendukung 15 profil.', 'Perangkat mendukung 14 profil.', false],
    ['Produk generasi kedua tersedia.', 'Produk ini merupakan generasi kedua.', true],
    ['Produk generasi kedua tersedia.', 'Produk ini tersedia untuk tim internal.', false],
    ['Produk ke-14 perusahaan tersedia.', 'Perusahaan mendukung 14 profil lokal.', false]
  ];
  for (const [text, evidence, valid] of checks) {
    assert.equal(finalizer.numericGroundingErrors({
      slides: [{ title: text, body: '', points: [], claims: [{ field: 'slide:0:title', text, sourceId: 'source-1', evidence }] }]
    }).length === 0, valid, `${text} <> ${evidence}`);
  }
});