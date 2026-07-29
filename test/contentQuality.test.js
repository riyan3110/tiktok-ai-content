const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createDatabase } = require('../src/db');
const { normalizeSlides, validateSlides } = require('../src/services/content');
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
