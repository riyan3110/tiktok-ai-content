const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const sourceFilter = require('../src/services/sourceFilter');
const finalizer = require('../src/services/sourceUrlFinalizer');

function atlasSource() {
  const facts = [
    'Atlas Device mendukung profil lokal untuk workstation bersama agar preferensi pengguna dapat dipisahkan dengan jelas.',
    'Atlas Device memungkinkan administrator menonaktifkan sinkronisasi latar belakang ketika kebijakan organisasi mengharuskannya.',
    'Atlas Device menyimpan preferensi pengguna secara lokal di antara sesi kerja pada workstation yang sama.',
    'Atlas Device memungkinkan operator mengekspor catatan konfigurasi untuk ditinjau kembali setelah sesi kerja selesai.',
    'Atlas Device menampilkan status profil langsung pada panel kontrol tanpa membuka layar tambahan lainnya.',
    'Atlas Device menyiapkan panduan migrasi untuk membantu tim memindahkan konfigurasi pada periode berikutnya.',
    'Pengujian Atlas Device mengaitkan pengaturan cache dengan waktu mulai perangkat yang menjadi lebih singkat.',
    'Atlas Device dapat mengurangi penggunaan memori ketika beberapa panel aplikasi dibiarkan tetap terbuka bersamaan.',
    'Atlas Device menyediakan kontrol profil agar administrator dapat melihat konfigurasi aktif pada workstation bersama.',
    'Atlas Device menyimpan pengaturan lokal sehingga preferensi tidak perlu dibuat ulang pada setiap sesi kerja.',
    'Atlas Device mencatat konfigurasi yang dapat diekspor untuk mendukung proses peninjauan oleh operator sistem.',
    'Atlas Device menyediakan panel status yang membantu operator memeriksa profil aktif dari satu tampilan.',
    'Atlas Device mendukung pengelolaan sinkronisasi agar administrator dapat menyesuaikannya dengan kebutuhan organisasi.',
    'Atlas Device menggunakan cache yang dalam pengujian dikaitkan dengan proses startup yang lebih singkat.',
    'Atlas Device mengelola penggunaan memori ketika sejumlah panel tetap aktif selama sesi kerja pengguna.',
    'Atlas Device dirancang untuk lingkungan workstation bersama yang menggunakan profil lokal antar pengguna.'
  ];
  return [{
    url: 'https://example.test/atlas-device',
    finalUrl: 'https://example.test/atlas-device',
    title: 'Atlas Device Profile Study',
    text: facts.join(' ')
  }];
}

function candidate() {
  const evidence = atlasSource()[0].text.split(/(?<=[.!?])\s+/);
  const sections = ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'];
  const titles = ['Profil Lokal untuk Workstation Bersama', 'Kontrol Sinkronisasi untuk Administrator', 'Status Profil dalam Satu Panel', 'Cache dan Penggunaan Memori'];
  const slides = sections.map((section, slideIndex) => {
    const base = slideIndex * 4;
    const bodyEvidence = evidence[base];
    const pointEvidence = evidence.slice(base + 1, base + 4);
    const body = bodyEvidence;
    const points = pointEvidence.map(value => value.replace(/^Atlas Device\s+/i, '').split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:]+$/g, ''));
    const claims = [
      { field: `slide:${slideIndex}:title`, text: titles[slideIndex], sourceId: 'source-1', evidence: bodyEvidence },
      { field: `slide:${slideIndex}:body`, text: body, sourceId: 'source-1', evidence: bodyEvidence },
      ...points.map((point, pointIndex) => ({
        field: `slide:${slideIndex}:point:${pointIndex}`,
        text: point,
        sourceId: 'source-1',
        evidence: pointEvidence[pointIndex]
      }))
    ];
    return { section, title: titles[slideIndex], body, points, claims };
  });
  return {
    topic: 'Atlas Device', effectiveContentFormat: 'Fakta singkat',
    hook: slides[0].title, body: slides[1].body, caption: slides[1].body,
    cta: slides.at(-1).title, hashtags: [], verificationStatus: 'source_based', slides
  };
}

function responseFor(content) {
  return { choices: [{ message: { content: JSON.stringify({ slides: content.slides }) } }] };
}

function clientSequence(responses) {
  let calls = 0;
  return {
    get calls() { return calls; },
    chat: { completions: { create: async () => responses[Math.min(calls++, responses.length - 1)] } }
  };
}

function disableSemanticAudit(t) {
  const original = sourceFilter.auditClaimSemantics;
  sourceFilter.auditClaimSemantics = async () => [];
  t.after(() => { sourceFilter.auditClaimSemantics = original; });
}

test('provider valid selesai dalam satu final rewrite tanpa raw fallback', async t => {
  disableSemanticAudit(t);
  const valid = candidate();
  const client = clientSequence([responseFor(valid)]);
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: valid, sources: atlasSource(), topic: 'Atlas Device', format: 'Fakta singkat', client
  });
  assert.equal(client.calls, 1);
  assert.equal(result.__urlSourceFallback, undefined);
  assert.equal(result.slides.length, 4);
  result.slides.forEach(slide => assert.equal(slide.points.length, 3));
});

test('provider output kosong tidak pernah ditampilkan sebagai raw source fallback', async t => {
  disableSemanticAudit(t);
  const valid = candidate();
  const empty = { choices: [{ message: { content: '' } }] };
  const client = clientSequence([empty, empty]);
  await assert.rejects(
    finalizer.rewriteAllSourcesWithAi({ generated: valid, sources: atlasSource(), topic: 'Atlas Device', format: 'Fakta singkat', client }),
    /Final Pakai URL belum dapat dibentuk|provider/i
  );
  assert.equal(client.calls, 2);
});

test('malformed JSON mendapat maksimal satu clean retry lalu gagal tanpa raw evidence output', async t => {
  disableSemanticAudit(t);
  const malformed = { choices: [{ message: { content: '```json\n{"slides": [ broken\n```' } }] };
  const client = clientSequence([malformed, malformed]);
  await assert.rejects(
    finalizer.rewriteAllSourcesWithAi({ generated: candidate(), sources: atlasSource(), topic: 'Atlas Device', format: 'Fakta singkat', client }),
    /Final Pakai URL belum dapat dibentuk|provider/i
  );
  assert.equal(client.calls, 2);
});

test('numeric mismatch mendapat satu clean rebuild dan hasil kedua yang grounded dipakai', async t => {
  disableSemanticAudit(t);
  const bad = candidate();
  bad.slides = bad.slides.map(slide => ({ ...slide, points: [...slide.points], claims: slide.claims.map(claim => ({ ...claim })) }));
  bad.slides[0].body = 'Atlas Device mendukung 99 profil lokal untuk workstation bersama pada satu perangkat.';
  const bodyClaim = bad.slides[0].claims.find(claim => claim.field === 'slide:0:body');
  bodyClaim.text = bad.slides[0].body;
  const good = candidate();
  const client = clientSequence([responseFor(bad), responseFor(good)]);
  const result = await finalizer.rewriteAllSourcesWithAi({ generated: bad, sources: atlasSource(), topic: 'Atlas Device', format: 'Fakta singkat', client });
  assert.equal(client.calls, 2);
  assert.equal(JSON.stringify(result.slides).includes('99 profil'), false);
  assert.equal(finalizer.numericGroundingErrors(result).length, 0);
});

test('semantic rejection tidak turun ke deterministic/raw fallback', async t => {
  const original = sourceFilter.auditClaimSemantics;
  sourceFilter.auditClaimSemantics = async () => ['SEMANTIC_SUPPORT: slide:0:body tidak didukung evidence'];
  t.after(() => { sourceFilter.auditClaimSemantics = original; });
  const valid = candidate();
  const client = clientSequence([responseFor(valid), responseFor(valid)]);
  await assert.rejects(
    finalizer.rewriteAllSourcesWithAi({ generated: valid, sources: atlasSource(), topic: 'Atlas Device', format: 'Fakta singkat', client }),
    /Final Pakai URL belum dapat dibentuk secara faktual dan natural/i
  );
  assert.equal(client.calls, 2);
});

test('manual URL relevance bank membuang drift artikel lain dari halaman topik utama', () => {
  const sources = [{
    url: 'https://example.test/mahasiswa',
    finalUrl: 'https://example.test/mahasiswa',
    title: 'AI Ubah Cara Mahasiswa Belajar',
    text: [
      'AI membantu mahasiswa memahami materi dan mencari penjelasan tambahan selama proses belajar di kampus.',
      'Mahasiswa tetap perlu memeriksa sumber dan membandingkan jawaban AI dengan materi perkuliahan yang digunakan.',
      'Dosen membantu mahasiswa memahami konteks dan menilai apakah jawaban AI sesuai dengan materi kuliah.',
      'Mahasiswa dapat memakai AI sebagai alat bantu belajar tanpa menggantikan proses berpikir dan diskusi akademik.',
      'Literasi AI membantu mahasiswa memahami keterbatasan jawaban model selama kegiatan belajar di perguruan tinggi.',
      'Produk rumah tangga terbaru menawarkan kamera beresolusi tinggi untuk konsumen yang mencari perangkat baru.',
      'Ponsel lipat generasi baru memiliki kamera 200 MP dan layar dengan desain yang berbeda.',
      'Berita olahraga terbaru membahas pertandingan besar yang berlangsung pada akhir pekan.'
    ].join(' ')
  }];
  const facts = require('../src/services/manualSourceFallback').sourceFacts(sources);
  const relevant = finalizer.relevantSourceFacts(sources, facts, 'AI Ubah Cara Mahasiswa Belajar');
  const text = relevant.map(fact => fact.evidence).join(' ');
  assert.match(text, /mahasiswa|belajar/i);
  assert.doesNotMatch(text, /200 MP|ponsel lipat|pertandingan besar|produk rumah tangga/i);
});

test('source candidate menolak potongan kutipan patah', () => {
  const text = [
    'AI membantu perusahaan memahami pola penggunaan teknologi pada kegiatan operasional sehari-hari.',
    'Tersedia," jelas narasumber ketika menjawab pertanyaan dari wartawan.',
    'Perusahaan tetap perlu mengevaluasi kebijakan internal sebelum menerapkan sistem secara lebih luas.'
  ].join(' ');
  const candidates = finalizer.sourceDisplayCandidates(text);
  assert.equal(candidates.some(value => /^Tersedia/i.test(value)), false);
  assert.equal(candidates.some(value => /AI membantu perusahaan/i.test(value)), true);
});

test('URL visual gate menangkap body yang tidak muat canvas', () => {
  const bad = { slides: [{
    title: 'Judul yang masih cukup pendek',
    body: 'Kalimat ini sengaja dibuat sangat panjang agar melampaui ruang body native canvas dan tidak boleh lolos ke renderer sebagai teks yang akan dipotong secara mekanis menjadi bagian yang berantakan untuk pengguna.',
    points: ['Fakta pendek tetap utuh']
  }] };
  assert.ok(finalizer.urlVisualFitErrors(bad).some(error => /body tidak muat/i.test(error)));
});

test('fenced JSON, text array, dan object parsed tetap dinormalisasi terbatas', () => {
  const valid = candidate();
  const sections = valid.slides.map(slide => slide.section);
  const fenced = { choices: [{ message: { content: `\n\`\`\`json\n${JSON.stringify({ slides: valid.slides })}\n\`\`\`\n` } }] };
  const array = { choices: [{ message: { content: [{ type: 'text', text: JSON.stringify({ slides: valid.slides }) }] } }] };
  const object = { choices: [{ message: { content: { slides: valid.slides } } }] };
  assert.deepEqual(finalizer.parseSlides(fenced, sections), valid.slides);
  assert.deepEqual(finalizer.parseSlides(array, sections), valid.slides);
  assert.deepEqual(finalizer.parseSlides(object, sections), valid.slides);
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
