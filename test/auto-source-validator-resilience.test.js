const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/autoSourceFinalizer');
const sourceFilter = require('../src/services/sourceFilter');
const autoSourceValidation = require('../src/services/autoSourceValidation');

function slide(title, body, points = [], claims = []) {
  return { section: 'FAKTA UTAMA', title, body, points, claims };
}

test('numeric grounding accepts a separated entity number only when the same source context contains it', () => {
  const body = 'Perangkat Nova 11 membawa panel baru untuk kelas perangkat kompak.';
  const evidence = 'Perangkat ini membawa panel baru untuk kelas perangkat kompak.';
  const sources = [{ title: 'Perangkat Nova 11 resmi diperkenalkan', text: evidence }];
  const content = {
    slides: [slide('Perangkat kompak generasi baru', body, [], [{
      field: 'slide:0:body', text: body, sourceId: 'source-1', evidence
    }])]
  };

  assert.deepEqual(finalizer.numericGroundingErrors(content, sources), []);
  finalizer.repairKnownNumericShorthand(content, sources);
  assert.match(content.slides[0].claims[0].evidence, /Nova 11/i);

  const checked = sourceFilter.validateVerifiedContent(content, { slides: content.slides }, {
    contentService: { validateContent: () => [] },
    format: 'Fakta singkat',
    manualTopic: 'Perangkat Nova 11',
    sources,
    autoSourceTopic: false
  });
  assert.equal(checked.errors.some(error => /Angka pada claim tidak didukung evidence/i.test(error)), false);
});

test('numeric grounding still rejects invented shorthand that is not written in source context', () => {
  const content = {
    slides: [slide('Layanan aktif setiap hari', 'Layanan tersedia 24/7 untuk semua pengguna sekarang.', [], [{
      field: 'slide:0:body',
      text: 'Layanan tersedia 24/7 untuk semua pengguna sekarang.',
      sourceId: 'source-1',
      evidence: 'Layanan tersedia setiap hari untuk pengguna.'
    }])]
  };
  const errors = autoSourceValidation.numericGroundingErrors(content, [{ title: 'Layanan harian', text: 'Layanan tersedia setiap hari untuk pengguna.' }]);
  assert.ok(errors.some(error => /24|7/.test(error)));
  assert.deepEqual([...finalizer.autoRecoveryFieldKeys(errors, content)], ['slide:0:body']);
});

test('layout validation uses one generic range independent of topic category', () => {
  const accepted = { slides: [
    slide('Konteks pertama', 'Sistem baru membantu perangkat membaca kondisi lingkungan secara langsung.', ['Sensor membaca kondisi sekitar', 'Data diproses di perangkat']),
    slide('Konteks kedua', 'Platform menggabungkan beberapa sinyal untuk menghasilkan respons yang lebih stabil.', ['Sinyal diproses secara lokal', 'Respons menyesuaikan kondisi sekitar']),
    slide('Konteks ketiga', 'Perangkat memakai pembaruan perangkat lunak untuk meningkatkan fungsi yang tersedia.', ['Pembaruan menambah fungsi baru', 'Perangkat tetap memakai sensor']),
    slide('Konteks keempat', 'Pengguna mendapat hasil pemrosesan melalui antarmuka yang dirancang lebih sederhana.', ['Hasil tampil lebih ringkas', 'Antarmuka menyatukan informasi utama'])
  ] };
  assert.deepEqual(autoSourceValidation.autoSourceLayoutErrors(accepted), []);

  const rejected = structuredClone(accepted);
  rejected.slides[1].body = 'Terlalu singkat untuk konteks.';
  assert.ok(autoSourceValidation.autoSourceLayoutErrors(rejected).some(error => /slide:1: body harus 8–24 kata/i.test(error)));
});

test('richness evaluates total slide information instead of a rigid source-specific body minimum', () => {
  const content = { slides: [
    slide('Konteks sistem utama', 'Sistem membaca beberapa sinyal untuk menentukan respons perangkat.', ['Sensor membaca kondisi sekitar', 'Proses berjalan di perangkat']),
    slide('Fungsi utama perangkat', 'Perangkat menggabungkan data sensor untuk menjaga respons tetap stabil.', ['Data sensor diproses lokal', 'Respons mengikuti kondisi terbaru']),
    slide('Pembaruan fungsi perangkat', 'Pembaruan perangkat lunak menambah fungsi tanpa mengganti perangkat keras.', ['Fungsi baru datang bertahap', 'Perangkat keras tetap digunakan']),
    slide('Hasil untuk pengguna', 'Pengguna melihat hasil melalui antarmuka yang menyatukan informasi utama.', ['Informasi tampil lebih ringkas', 'Kontrol tersedia dalam antarmuka'])
  ] };
  const facts = Array.from({ length: 12 }, (_, index) => ({ sourceId: 'source-1', evidence: `Fakta sumber nomor ${index + 1} memiliki detail berbeda yang cukup untuk pengujian.` }));
  const errors = finalizer.richnessErrors(content, facts);
  assert.equal(errors.some(error => /body terlalu tipis/i.test(error)), false);
});

test('richness allows one grounded bullet after safe recovery when the slide remains dense', () => {
  const content = { slides: Array.from({ length: 4 }, () => slide(
    'Konteks sistem perangkat utama',
    'Sistem menggabungkan beberapa sinyal lokal agar respons perangkat tetap stabil saat kondisi berubah.',
    ['Sensor membaca kondisi sekitar']
  )) };
  const facts = Array.from({ length: 16 }, (_, index) => ({ sourceId: 'source-1', evidence: `Fakta sumber ${index + 1} memiliki detail berbeda yang cukup untuk pengujian kepadatan.` }));
  assert.deepEqual(finalizer.richnessErrors(content, facts), []);
});

test('targeted recovery can delete an unsupported point without shifting another point into the wrong claim', () => {
  const draft = { slides: [slide('Konteks', 'Body tetap sama untuk pengujian targeted recovery.', ['Detail unsupported lama', 'Detail grounded lain'], [
    { field: 'slide:0:point:0', text: 'Detail unsupported lama', sourceId: 'source-1', evidence: 'Evidence lama.' },
    { field: 'slide:0:point:1', text: 'Detail grounded lain', sourceId: 'source-1', evidence: 'Evidence grounded lain.' }
  ])] };
  const incoming = { slides: [{
    ...draft.slides[0],
    points: [null, 'Detail grounded lain'],
    claims: [{ field: 'slide:0:point:1', text: 'Detail grounded lain', sourceId: 'source-1', evidence: 'Evidence grounded lain.' }]
  }] };
  const merged = finalizer.mergeAutoRecoveryFields(draft, incoming, new Set(['slide:0:point:0']));
  assert.deepEqual(merged.slides[0].points, ['Detail grounded lain']);
  assert.equal(merged.slides[0].claims.length, 1);
  assert.equal(merged.slides[0].claims[0].field, 'slide:0:point:0');
});

test('semantic support errors remain targetable for the final safe recovery pass', () => {
  const keys = finalizer.autoRecoveryFieldKeys([
    "SEMANTIC_SUPPORT: slide:1:point:0 tidak didukung evidence: Claim adds 'via text' not stated in evidence."
  ], { slides: [] });
  assert.deepEqual([...keys], ['slide:1:point:0']);
});

test('duplicate validation compares visible meaning rather than canonical evidence identity', () => {
  const evidence = 'Satu sumber menjelaskan fitur pemrosesan lokal sekaligus kontrol antarmuka baru.';
  const content = { slides: [
    slide('Pemrosesan lokal', 'Perangkat memproses sebagian data secara lokal untuk respons lebih cepat.', [], [{ field: 'slide:0:body', text: 'Perangkat memproses sebagian data secara lokal untuk respons lebih cepat.', sourceId: 'source-1', evidence }]),
    slide('Kontrol antarmuka', 'Antarmuka menambahkan kontrol baru untuk mengatur hasil pemrosesan pengguna.', [], [{ field: 'slide:1:body', text: 'Antarmuka menambahkan kontrol baru untuk mengatur hasil pemrosesan pengguna.', sourceId: 'source-1', evidence }])
  ] };
  assert.deepEqual(autoSourceValidation.autoSourceDuplicateErrors(content), []);
});

test('genuinely repeated visible facts are rejected even when wording is slightly changed', () => {
  const content = { slides: [
    slide('Pemrosesan lokal', 'Perangkat memproses data secara lokal untuk respons yang lebih cepat.'),
    slide('Proses lokal perangkat', 'Perangkat memproses data lokal agar respons menjadi lebih cepat.')
  ] };
  assert.ok(autoSourceValidation.autoSourceDuplicateErrors(content).some(error => /mengulang fakta slide sebelumnya/i.test(error)));
});

test('generic validators produce the same outcome for unrelated topic labels', () => {
  const bodies = [
    'Sistem menggabungkan beberapa sinyal untuk menghasilkan respons yang lebih stabil.',
    'Perangkat memproses data secara lokal agar hasil tersedia lebih cepat.',
    'Platform menambahkan kontrol baru untuk mengatur informasi yang ditampilkan.'
  ];
  const labels = ['Perangkat komputasi', 'Teknologi kesehatan', 'Sistem transportasi'];
  labels.forEach((label, index) => {
    const content = { slides: [
      slide(`${label} satu`, bodies[index], ['Sensor membaca kondisi sekitar', 'Data diproses secara lokal']),
      slide(`${label} dua`, 'Pembaruan menambahkan fungsi baru tanpa mengganti seluruh sistem perangkat.', ['Fungsi baru tersedia bertahap', 'Sistem lama tetap digunakan']),
      slide(`${label} tiga`, 'Antarmuka menyatukan informasi utama agar hasil lebih mudah dibaca pengguna.', ['Informasi tampil lebih ringkas', 'Kontrol tersedia dalam antarmuka']),
      slide(`${label} empat`, 'Pengguna menerima hasil pemrosesan setelah sistem menyelesaikan analisis data utama.', ['Hasil mengikuti data terbaru', 'Analisis berjalan dalam sistem'])
    ] };
    assert.deepEqual(autoSourceValidation.autoSourceLayoutErrors(content), []);
  });
});
