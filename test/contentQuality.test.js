const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createDatabase } = require('../src/db');
const { generateContent, normalizeSlides, normalizeProblemSolutionSlides, validateContent, validateSlides } = require('../src/services/content');
const { generateAndSave, similarityToHistory } = require('../src/services/generation');

const slide = (section, body, extra = {}) => ({ section, title: extra.title || '', body, points: extra.points || [] });

test('normalisasi menerima response AI dengan field body dan content', () => {
  assert.deepEqual(normalizeSlides([
    { label: 'A', heading: 'Judul', body: 'Isi', points: [] },
    { section: 'B', title: 'Judul 2', content: 'Isi alternatif', points: [] }
  ]), [
    { section: 'A', title: 'Judul', body: 'Isi', points: [] },
    { section: 'B', title: 'Judul 2', body: 'Isi alternatif', points: [] }
  ]);
});

test('body multi-line memindahkan baris pendek menjadi maksimal tiga points', () => {
  assert.deepEqual(normalizeSlides([{
    section: 'PEMBUKA', title: 'Pagi yang Sibuk',
    body: 'Pagi yang kacau bisa menurunkan fokus.\nBangun buru-buru\nCek handphone\nTanpa rencana'
  }]), [{
    section: 'PEMBUKA', title: 'Pagi yang Sibuk',
    body: 'Pagi yang kacau bisa menurunkan fokus.',
    points: ['Bangun buru-buru', 'Cek handphone', 'Tanpa rencana']
  }]);
});

test('validator membatasi title, body, dan panjang point secara terpisah', () => {
  const slides = carousel(slide('ISI', sentence(25), {
    title: sentence(13), points: ['satu dua tiga empat lima enam tujuh delapan']
  }));
  const message = validateSlides(slides).join(' ');
  assert.match(message, /title maksimal 12 kata/);
  assert.match(message, /body maksimal 24 kata/);
  assert.match(message, /point 1 maksimal 7 kata/);
});

test('body tepat 24 kata tetap valid', () => {
  assert.deepEqual(validateSlides(carousel(slide('PENJELASAN', sentence(24)))), []);
});

test('solusi bullet tanpa numbering valid', () => {
  const slides = [slide('MASALAH', 'Penjualan melambat', { title: 'Masalah toko' }), slide('SOLUSI', '', { title: 'Solusi', points: ['Audit produk', 'Perbaiki penawaran'] }), slide('PENUTUP', 'Simpan')];
  assert.deepEqual(validateSlides(slides, { format: 'Masalah dan solusi' }), []);
});

test('solusi nomor dua dinormalisasi dan daftar body dipindahkan ke points', () => {
  const normalized = normalizeProblemSolutionSlides([
    slide('MASALAH', 'Stok lama menumpuk', { title: 'Masalah stok' }),
    slide('Solusi 2', '2. Audit stok\n3. Buat bundel', { title: 'Tindakan' }),
    slide('PENUTUP', 'Simpan')
  ]);
  assert.equal(normalized[0].section, 'MASALAH');
  assert.deepEqual(normalized[1].points, ['Audit stok', 'Buat bundel']);
  assert.equal(normalized[1].body, '');
});

test('slide masalah tanpa solusi gagal dengan satu pesan spesifik', () => {
  const errors = validateSlides([slide('MASALAH', 'Stok lama'), slide('ISI', 'Dampak modal'), slide('PENUTUP', 'Simpan')], { format: 'Masalah dan solusi' });
  assert.deepEqual(errors, ['Format Masalah dan solusi tidak memiliki slide SOLUSI.']);
});

test('error validasi akhir tidak menggabungkan dua masalah', async () => {
  const invalid = { focus: { masalah: 'A', penyebab: 'B', solusi: 'C', hasil: 'D' }, topic: 'Topik', hook: sentence(19), body: 'Isi', caption: 'Caption', hashtags: [], cta: 'Simpan', trendKeywordsUsed: [], slides: carousel(slide('ISI', sentence(25))) };
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(invalid) } }] }) } } };
  await assert.rejects(() => generateContent([], {}, client), error => error.validationErrors.length > 1 && !error.message.includes(error.validationErrors[1]));
});

test('hook 19 kata diperbaiki menjadi maksimal 18 kata', async () => {
  const base = { focus: { masalah: 'A', penyebab: 'B', solusi: 'C', hasil: 'D' }, topic: 'Topik', body: 'Isi', caption: 'Caption', hashtags: [], cta: 'Simpan', trendKeywordsUsed: [], slides: carousel(slide('ISI', 'Isi')) };
  let calls = 0;
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ ...base, hook: sentence(++calls === 1 ? 19 : 18) }) } }] }) } } };
  const result = await generateContent([], {}, client);
  assert.equal(result.hook.split(/\s+/).length, 18);
  assert.equal(calls, 2);
});

test('validator melaporkan satu slide kosong dan menghapusnya saat normalisasi', () => {
  const input = [slide('PEMBUKA', 'Ada isi'), {}, slide('PENUTUP', 'Ada isi')];
  assert.match(validateSlides(input).join(' '), /Slide 2.*title, body, atau points/);
  assert.equal(normalizeSlides(input).length, 2);
});

test('validator menolak seluruh slide kosong', () => {
  assert.match(validateSlides([{}, {}, {}]).join(' '), /hanya 0 slide berisi/);
});

test('validator menolak nomor langkah tidak berurutan dan label yang tidak sesuai isi', () => {
  const input = [slide('PEMBUKA', 'Mulai'), slide('LANGKAH 1', '1. Pertama'), slide('LANGKAH 2', '3. Ketiga')];
  const message = validateSlides(input, { format: 'Tutorial langkah' }).join(' ');
  assert.match(message, /label LANGKAH 2 tidak sesuai dengan nomor isi 3/);
});

const sentence = count => Array.from({ length: count }, (_, index) => `kata${index + 1}`).join(' ');
const carousel = middle => [
  slide('PEMBUKA', '', { title: 'Hook singkat' }),
  middle,
  slide('PENUTUP', 'Simpan panduan ini')
];

test('slide isi pendek 36 kata dilaporkan dengan nomor, jumlah, dan batas adaptif', () => {
  const errors = validateSlides(carousel(slide('ISI', sentence(36))));
  assert.ok(errors.includes('Slide 2 memiliki 36 kata, batas maksimal 35 kata.'));
});

test('slide penjelasan tepat 22 kata diterima', () => {
  assert.deepEqual(validateSlides(carousel(slide('PENJELASAN', sentence(22)))), []);
});

test('slide 60 kata ditolak dan label, nomor, footer, serta metadata tidak ikut dihitung', () => {
  const errors = validateSlides(carousel(slide('LANGKAH 1', `LANGKAH 1: ${sentence(60)}\nFooter: akun\nMetadata: kampanye`)));
  assert.ok(errors.includes('Slide 2 memiliki 60 kata, batas maksimal 45 kata.'));
  assert.deepEqual(validateSlides(carousel(slide('ISI', `Nomor slide: 2\n${sentence(22)}\nFooter: akun`))), []);
});

test('validator memastikan hasil akhir tetap 3–5 slide', () => {
  assert.deepEqual(validateSlides(carousel(slide('ISI', 'Isi'))), []);
  assert.match(validateSlides([slide('PEMBUKA', 'Hook'), slide('PENUTUP', 'CTA')]).join(' '), /minimal 3 slide/);
  assert.match(validateSlides(Array.from({ length: 6 }, (_, index) => slide(index ? 'ISI' : 'PEMBUKA', 'Isi'))).join(' '), /maksimal 5 slide/);
});

test('perbaikan otomatis meringkas slide terlalu panjang', async () => {
  const base = { focus: { masalah: 'Lambat', penyebab: 'Manual', solusi: 'Ringkas', hasil: 'Cepat' }, topic: 'Topik', hook: 'Hook singkat', body: 'Tulis poin praktis', caption: 'Panduan singkat.', hashtags: ['#Tips'], cta: 'Simpan', trendKeywordsUsed: [] };
  const responses = [
    { ...base, slides: carousel(slide('ISI', sentence(36))) },
    { ...base, slides: carousel(slide('ISI', sentence(22))) }
  ];
  let calls = 0;
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(responses[calls++]) } }] }) } } };
  const result = await generateContent([], {}, client);
  assert.equal(calls, 2);
  assert.equal(result.slides.length, 3);
});

test('perbaikan otomatis dapat memindahkan poin kedua ke slide berikutnya', async () => {
  const base = { focus: { masalah: 'Lambat', penyebab: 'Manual', solusi: 'Bagi poin', hasil: 'Jelas' }, topic: 'Topik', hook: 'Hook singkat', body: 'Bagi dua tindakan', caption: 'Dua tindakan praktis.', hashtags: ['#Tips'], cta: 'Simpan', trendKeywordsUsed: [] };
  const responses = [
    { ...base, slides: carousel(slide('ISI', sentence(60))) },
    { ...base, slides: [slide('PEMBUKA', '', { title: 'Hook singkat' }), slide('ISI', sentence(22)), slide('ISI', sentence(22)), slide('PENUTUP', 'Simpan panduan ini')] }
  ];
  let calls = 0;
  const requests = [];
  const client = { chat: { completions: { create: async request => { requests.push(request); return { choices: [{ message: { content: JSON.stringify(responses[calls++]) } }] }; } } } };
  const result = await generateContent([], {}, client);
  assert.equal(result.slides.length, 4);
  assert.match(requests[1].messages.at(-1).content, /pindahkan poin kedua ke slide berikutnya/i);
});

test('similarity membandingkan angle, tool, hook, langkah, dan CTA', () => {
  const item = { topic: 'Riset AI', content_angle: 'workflow riset', primary_tool: 'Perplexity', hook_pattern: 'hemat waktu', hook: 'Hemat waktu', body: '1. Cari sumber 2. Verifikasi', cta: 'Simpan' };
  assert.equal(similarityToHistory(item, [item]), 1);
});

test('generator memilih angle baru ketika hasil pertama terlalu mirip riwayat', async () => {
  const db = createDatabase(':memory:');
  db.prepare('INSERT INTO contents(topic,content_angle,primary_tool,hook_pattern,hook,body,caption,hashtags,cta) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('Riset AI', 'workflow riset', 'Perplexity', 'hemat waktu', 'Hemat waktu', '1. Cari sumber', 'Caption', '[]', 'Simpan');
  let calls = 0;
  const base = { hook: 'Hook baru', body: '1. Tulis naskah', caption: 'Caption', hashtags: [], cta: 'Bagikan', primary_tool: 'Gamma', hook_pattern: 'before-after' };
  const old = { topic: 'Riset AI versi lain', content_angle: 'workflow riset', primary_tool: 'Perplexity', hook_pattern: 'hemat waktu', hook: 'Hemat waktu', body: '1. Cari sumber', caption: 'Caption', hashtags: [], cta: 'Simpan' };
  const id = await generateAndSave({ db, content: { generateContent: async () => (++calls === 1 ? old : { ...base, topic: 'Presentasi AI', content_angle: 'before-after presentasi' }) }, images: { createSlides: async () => ['/generated/test.jpg'] } });
  assert.equal(calls, 2);
  assert.equal(db.prepare('SELECT content_angle FROM contents WHERE id=?').get(id).content_angle, 'before-after presentasi');
  db.close();
});

test('UI mempertahankan preview lama saat generate gagal dan menyediakan tombol coba ulang', () => {
  const source = fs.readFileSync('public/app.js', 'utf8');
  assert.match(source, /Do not call show\(\) on failure/);
  assert.match(source, /retry-generate/);
  assert.match(fs.readFileSync('public/index.html', 'utf8'), /Coba buat ulang/);
});
