const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER = 'gemini';
process.env.AI_API_KEY = 'test-key';
process.env.AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
process.env.AI_MODEL = 'gemini-2.5-flash-lite';

const config = require('../src/config');
const { generateContent } = require('../src/services/content');

test('validasi konfigurasi AI memberi pesan untuk variable yang belum diisi', () => {
  assert.throws(
    () => config.validateAiConfigValues({ aiProvider: 'gemini' }),
    /AI_API_KEY, AI_BASE_URL, AI_MODEL/
  );
});

test('validasi konfigurasi AI menolak provider yang tidak didukung', () => {
  assert.throws(
    () => config.validateAiConfigValues({ aiProvider: 'unknown', aiApiKey: 'key', aiBaseUrl: 'https://example.com/v1', aiModel: 'model' }),
    /Gunakan salah satu: gemini, groq, openai/
  );
});

test('generate memakai Chat Completions dan mempertahankan struktur JSON', async () => {
  let request;
  const expected = { focus: { masalah: 'Brief kabur', penyebab: 'Tujuan kosong', solusi: 'Tulis tujuan', hasil: 'Brief jelas' }, topic: 'Topik', hook: 'Brief Kabur Membuat Visual Salah Arah', body: '1. Tulis tujuan visual yang terukur', caption: 'Tulis tujuan agar brief lebih jelas.', hashtags: ['#AI'], cta: 'Coba sekarang', trendKeywordsUsed: [] };
  const client = { chat: { completions: { create: async (value) => {
    request = value;
    return { choices: [{ message: { content: JSON.stringify(expected) } }] };
  } } } };

  const result = await generateContent([], client);

  assert.deepEqual(result, expected);
  assert.equal(request.model, 'gemini-2.5-flash-lite');
  assert.equal(request.response_format.type, 'json_object');
  assert.match(request.messages[1].content, /"required":\["focus","topic","hook","body","caption","hashtags","cta","trendKeywordsUsed"\]/);
});

test('prompt mengarahkan bahasa natural tanpa mengubah respons atau menambah panggilan AI', async () => {
  const expected = { focus: { masalah: 'Brief kabur', penyebab: 'Tujuan kosong', solusi: 'Tulis tujuan', hasil: 'Brief jelas' }, topic: 'Brief visual', hook: 'Brief yang Jelas Bikin Visual Lebih Terarah', body: 'Tulis tujuan visual sebelum memilih referensi.', caption: 'Mulai brief dari tujuan visual yang jelas.', hashtags: ['#KontenKreator'], cta: 'Coba di brief berikutnya', trendKeywordsUsed: [], content_angle: 'brief praktis', primary_tool: 'tanpa tool', hook_pattern: 'pernyataan langsung' };
  const requests = [];
  const client = { chat: { completions: { create: async (request) => {
    requests.push(request);
    return { choices: [{ message: { content: JSON.stringify(expected) } }] };
  } } } };

  const result = await generateContent([], client);
  const { messages } = requests[0];
  const prompt = messages[1].content;

  assert.equal(requests.length, 1, 'respons valid cukup memakai satu panggilan AI');
  assert.deepEqual(result, expected, 'hasil AI tidak ditulis ulang oleh tahap humanizer');
  assert.match(messages[0].content, /natural, ringkas, conversational, dan tetap akurat/i);
  assert.match(prompt, /bahasa Indonesia sehari-hari yang rapi/i);
  assert.match(prompt, /bukan seperti buku pelajaran, laporan, atau presentasi perusahaan/i);
  assert.match(prompt, /template AI/i);
  assert.match(prompt, /variasikan bentuk hook antarkonten secara alami/i);
  assert.match(prompt, /Pertanyaan hanya digunakan ketika cocok.*jangan memaksa setiap judul menjadi pertanyaan/i);
  assert.match(prompt, /jangan mengulang title di body atau points/i);
  assert.match(prompt, /jangan menambahkan pengalaman pribadi palsu maupun fakta, angka, tren, atau klaim yang tidak tersedia/i);
  assert.match(prompt, /Kembalikan hanya JSON sesuai schema/i);
  assert.match(prompt, /"required":\["focus","topic","hook","body","caption","hashtags","cta","trendKeywordsUsed","content_angle","primary_tool","hook_pattern","slides"\]/);
  for (const field of ['section', 'title', 'body', 'points']) assert.match(prompt, new RegExp(`"${field}"`));
});

test('generate memberi pesan jelas ketika provider mengembalikan JSON invalid', async () => {
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'bukan JSON' } }] }) } } };
  await assert.rejects(() => generateContent([], client), /mengembalikan JSON yang tidak valid/);
});
test('prompt mengikuti kategori, format, dan menjaga inti topik manual', async () => {
  let request;
  const result = { focus: { masalah: 'Istilah rumit', penyebab: 'Tanpa analogi', solusi: 'Pakai analogi', hasil: 'Konsep dipahami' }, topic: 'Blockchain untuk pemula', hook: 'Blockchain Terasa Rumit Karena Istilah Ini', body: 'MASALAH: Istilah blockchain sulit dipahami\nPENYEBAB: Penjelasan tanpa analogi\nSOLUSI 1: Bandingkan ledger dengan buku kas\nSOLUSI 2: Tunjukkan satu transaksi sederhana\nLANGKAH PERTAMA: Tulis contoh transfer dua orang\nHASIL YANG DIHARAPKAN: Pembaca memahami alur dasar', caption: 'Pahami blockchain lewat buku kas dan contoh transaksi.', hashtags: ['#Teknologi'], cta: 'Simpan panduan ini' };
  const client = { chat: { completions: { create: async (value) => { request = value; return { choices: [{ message: { content: JSON.stringify(result) } }] }; } } } };
  await generateContent([], { topicSource: 'manual', requestedTopic: 'Blockchain untuk pemula', contentCategory: 'Edukasi teknologi', contentFormat: 'Masalah dan solusi' }, client);
  const prompt = request.messages[1].content;
  assert.match(prompt, /jangan mengubah inti topiknya/i);
  assert.match(prompt, /bahasa sederhana/);
  assert.match(prompt, /section MASALAH/);
  assert.match(prompt, /Jangan memaksakan isi menjadi video iklan/);
});

test('prompt memisahkan keyword, gaya hook, dan pola konten sesuai kegunaannya', async () => {
  let request;
  const result = { focus: { masalah: 'Waktu habis', penyebab: 'Proses manual', solusi: 'Otomasi', hasil: 'Lebih cepat' }, topic: 'Otomasi', hook: 'Kerja Manual Menghabiskan Waktu', body: '1. Otomatiskan satu tugas yang berulang setiap hari agar waktu kerja lebih terjaga', caption: 'Mulai dari satu otomasi sederhana.', hashtags: ['#AI'], cta: 'Coba hari ini', trendKeywordsUsed: ['#AI'] };
  const client = { chat: { completions: { create: async value => { request = value; return { choices: [{ message: { content: JSON.stringify(result) } }] }; } } } };
  await generateContent([], { trendReference: { keywords: ['#AI'], trend_hooks: ['Ternyata selama ini...'], trend_content_patterns: ['Listicle'], notes: '' } }, client);
  const prompt = request.messages[1].content;
  assert.match(prompt, /KEYWORD\/HASHTAG.*hanya untuk memilih istilah dan konteks/i);
  assert.match(prompt, /GAYA HOOK.*hanya sebagai referensi kalimat pembuka/i);
  assert.match(prompt, /POLA KONTEN.*hanya sebagai referensi struktur penyampaian/i);
  assert.match(prompt, /Jangan mencampurkan ketiganya sebagai satu daftar/i);
  assert.match(prompt, /buat variasi yang natural/i);
});

test('validasi masalah-solusi tidak memaksa numbering tetapi tetap menolak isi duplikat', () => {
  const { validateContent } = require('../src/services/content');
  const content = { focus: { masalah: 'Stok lama', penyebab: 'Tidak dihitung', solusi: 'Audit', hasil: 'Stok turun' }, topic: 'Audit stok', hook: 'Stok Lama Mengunci Uang Toko Anda', body: 'MASALAH: Stok lama tidak terjual\nPENYEBAB: Produk tidak pernah diaudit\nSOLUSI 2: Hitung stok selama 30 hari\nSOLUSI 3: Hitung stok selama 30 hari\nLANGKAH PERTAMA: Pisahkan produk lambat\nHASIL YANG DIHARAPKAN: Modal kembali bertahap', caption: 'Audit stok lama.', hashtags: ['#Bisnis'], cta: 'Simpan panduan ini' };
  const errors = validateContent(content, { format: 'Masalah dan solusi' });
  assert.ok(!errors.some((error) => /Urutan solusi/i.test(error)));
  assert.ok(errors.some((error) => /berulang/i.test(error)));
});

test('numbering solusi lama tidak memicu pembuatan ulang AI', async () => {
  const valid = { focus: { masalah: 'Stok lama', penyebab: 'Tanpa audit', solusi: 'Pisahkan stok', hasil: 'Modal cair' }, topic: 'Audit stok', hook: 'Stok Lama Mengunci Modal Toko', body: 'MASALAH: Stok tidak terjual 30 hari\nPENYEBAB: Perputaran barang tidak dicatat\nSOLUSI 1: Hitung stok berumur 30 hari\nSOLUSI 2: Bundel barang yang lambat laku\nLANGKAH PERTAMA: Ekspor laporan stok hari ini\nHASIL YANG DIHARAPKAN: Modal kembali tanpa memangkas semua margin', caption: 'Audit stok, lalu bundel barang lambat agar modal kembali.', hashtags: ['#Bisnis'], cta: 'Simpan untuk audit stok' };
  let calls = 0;
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(calls++ ? valid : { ...valid, body: valid.body.replace('SOLUSI 1', 'SOLUSI 2').replace('SOLUSI 2', 'SOLUSI 3') }) } }] }) } } };
  assert.deepEqual(await generateContent([], { contentFormat: 'Masalah dan solusi' }, client), valid);
  assert.equal(calls, 1);
});
