const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

function setup(overrides = {}) {
  const db = createDatabase(':memory:');
  const content = overrides.content || { generateContent: async (topics, options) => ({ topic: options.requestedTopic || (topics.length ? 'Topik Baru' : 'Storyboard AI'), hook: 'Hook kuat', body: '1. Tulis brief\n2. Buat visual', caption: 'Coba cara ini', hashtags: ['#AIAds'], cta: 'Simpan dan ikuti' }) };
  const images = overrides.images || { createSlides: async (id) => [`/generated/${id}-1.jpg`, `/generated/${id}-2.jpg`, `/generated/${id}-3.jpg`], validateSlides: async () => {} };
  const tiktok = overrides.tiktok || { randomState: () => 'state', authorizationUrl: () => 'https://example.com/oauth', validateImageUrls: async () => {}, publishPhotos: async () => ({ data: { publish_id: 'pub-1' } }), status: async () => ({ data: { status: 'SEND_TO_USER_INBOX' } }) };
  return { db, app: createApp({ db, content, images, tiktok, trending: overrides.trending || { getLatest: async () => [] } }) };
}
test('generate menyimpan struktur konten dan tiga slide', async () => { const { app } = setup(); const r = await request(app).post('/generate').send({ topicSource: 'ai' }).expect(200); assert.equal(r.body.topic, 'Storyboard AI'); assert.equal(r.body.topic_source, 'ai'); assert.equal(r.body.slides.length, 3); assert.deepEqual(r.body.hashtags, ['#AIAds']); });
test('topik manual wajib dipakai dan disimpan bersama sumber serta input asli', async () => { const { app } = setup(); const r = await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: '  Tutorial   sepatu AI  ' }).expect(200); assert.equal(r.body.topic, 'Tutorial sepatu AI'); assert.equal(r.body.requested_topic, 'Tutorial sepatu AI'); assert.equal(r.body.topic_source, 'manual'); });
test('topik manual kosong ditolak', async () => { const { app } = setup(); await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: ' ' }).expect(400); });
test('topik trending memakai topik relevan dari service', async () => { let options; const content = { generateContent: async (topics, value) => { options = value; return { topic: value.requestedTopic, hook: 'H', body: '1. B', caption: 'C', hashtags: ['#AI'], cta: 'CTA' }; } }; const { app } = setup({ content, trending: { getLatest: async () => ['Tren Canva AI'] } }); const r = await request(app).post('/generate').send({ topicSource: 'trending' }).expect(200); assert.equal(options.requestedTopic, 'Tren Canva AI'); assert.equal(options.trendingFallback, false); assert.equal(r.body.topic_source, 'trending'); });
test('topik trending fallback ke AI berdasarkan tanggal saat service gagal', async () => { let options; const content = { generateContent: async (topics, value) => { options = value; return { topic: 'Tren AI Hari Ini', hook: 'H', body: '1. B', caption: 'C', hashtags: ['#AI'], cta: 'CTA' }; } }; const { app } = setup({ content, trending: { getLatest: async () => { throw new Error('offline'); } } }); await request(app).post('/generate').send({ topicSource: 'trending' }).expect(200); assert.equal(options.trendingFallback, true); assert.match(options.date, /^\d{4}-\d{2}-\d{2}$/); });
test('duplikat AI dibandingkan tanpa kapital dan spasi lalu generate ulang', async () => { let calls = 0; const content = { generateContent: async () => ({ topic: ++calls === 1 ? '  STORYBOARD   ai ' : 'Topik Unik', hook: 'H', body: '1. B', caption: 'C', hashtags: ['#AI'], cta: 'CTA' }) }; const { app, db } = setup({ content }); db.prepare("INSERT INTO contents(topic,hook,body,caption,hashtags,cta) VALUES('Storyboard AI','H','B','C','[]','CTA')").run(); const r = await request(app).post('/generate').send({ topicSource: 'ai' }).expect(200); assert.equal(calls, 2); assert.equal(r.body.topic, 'Topik Unik'); });
test('history mengembalikan konten terbaru', async () => { const { app } = setup(); await request(app).post('/generate'); const r = await request(app).get('/history').expect(200); assert.equal(r.body.length, 1); });
test('hapus satu konten menolak ID invalid dan hanya menghapus item yang dipilih', async () => {
  const { app, db } = setup();
  await request(app).post('/generate');
  db.prepare("INSERT INTO contents(topic,hook,body,caption,hashtags,cta) VALUES('Tetap ada','H','B','C','[]','CTA')").run();
  await request(app).delete('/history/abc').expect(400);
  const response = await request(app).delete('/history/1').expect(200);
  assert.equal(response.body.deleted, 1);
  assert.deepEqual(db.prepare('SELECT topic FROM contents ORDER BY id').all(), [{ topic: 'Tetap ada' }]);
});
test('hapus seluruh riwayat mengosongkan database', async () => {
  const { app, db } = setup();
  await request(app).post('/generate');
  db.prepare("INSERT INTO contents(topic,hook,body,caption,hashtags,cta) VALUES('Konten dua','H','B','C','[]','CTA')").run();
  const response = await request(app).delete('/history').expect(200);
  assert.equal(response.body.deleted, 2);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM contents').get().count, 0);
});
test('upload ditolak bila OAuth belum terhubung', async () => { const { app } = setup(); const c = await request(app).post('/generate'); const r = await request(app).post('/upload-tiktok').send({ id: c.body.id }).expect(401); assert.match(r.body.error, /Hubungkan/); });
test('upload memvalidasi slide dan menampilkan pesan Indonesia sebelum mengirim ke TikTok', async () => {
  const images = {
    createSlides: async () => ['/generated/slide-lama.png'],
    validateSlides: async () => { throw Object.assign(new Error('File slide bukan JPEG asli. Buat ulang konten sebelum mengunggah.'), { status: 400 }); }
  };
  const { app, db } = setup({ images });
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,expires_at) VALUES('tiktok','token',?)").run(Date.now() + 3600000);
  const c = await request(app).post('/generate');
  const r = await request(app).post('/upload-tiktok').send({ id: c.body.id }).expect(400);
  assert.match(r.body.error, /bukan JPEG asli/);
});
test('upload memeriksa URL publik sebelum mengirim draft ke TikTok', async () => {
  const calls = [];
  const tiktok = { randomState: () => 'state', authorizationUrl: () => '', validateImageUrls: async (urls, prefix) => calls.push({ urls, prefix }), publishPhotos: async () => ({ data: { publish_id: 'draft-1' } }) };
  const { app, db } = setup({ tiktok });
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,expires_at) VALUES('tiktok','token',?)").run(Date.now() + 3600000);
  const content = await request(app).post('/generate');
  const response = await request(app).post('/upload-tiktok').send({ id: content.body.id }).expect(200);
  assert.equal(response.body.publishId, 'draft-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prefix, 'http://localhost:3000/generated/');
  assert.ok(calls[0].urls.every(url => url.startsWith(calls[0].prefix)));
});
test('status draft menyimpan status, fail_reason, dan downloaded_bytes', async () => {
  const tiktok = { randomState: () => 'state', authorizationUrl: () => '', status: async () => ({ data: { status: 'PROCESSING_DOWNLOAD', fail_reason: 'download pending', downloaded_bytes: 1234 } }) };
  const { app, db } = setup({ tiktok });
  db.prepare("INSERT INTO oauth_tokens(provider,access_token,expires_at) VALUES('tiktok','token',?)").run(Date.now() + 3600000);
  db.prepare("INSERT INTO contents(topic,hook,body,caption,hashtags,cta,publish_id) VALUES('T','H','B','C','[]','CTA','pub-1')").run();
  const response = await request(app).get('/status/pub-1').expect(200);
  assert.deepEqual(response.body, { status: 'PROCESSING_DOWNLOAD', fail_reason: 'download pending', downloaded_bytes: 1234 });
  const saved = db.prepare("SELECT publish_status,fail_reason,downloaded_bytes FROM contents WHERE publish_id='pub-1'").get();
  assert.deepEqual(saved, { publish_status: 'PROCESSING_DOWNLOAD', fail_reason: 'download pending', downloaded_bytes: 1234 });
});
test('OAuth dimulai dengan redirect', async () => { const { app } = setup(); await request(app).get('/auth/tiktok').expect(302).expect('Location', 'https://example.com/oauth'); });
test('status koneksi TikTok belum terhubung saat token tidak tersedia', async () => { const { app } = setup(); const r = await request(app).get('/tiktok/connection-status').expect(200); assert.deepEqual(r.body, { connected: false, message: 'TikTok belum terhubung' }); });
test('status koneksi TikTok terhubung saat token tersedia', async () => { const { app, db } = setup(); db.prepare("INSERT INTO oauth_tokens(provider,access_token,expires_at) VALUES('tiktok','token',?)").run(Date.now() + 3600000); const r = await request(app).get('/tiktok/connection-status').expect(200); assert.deepEqual(r.body, { connected: true, message: 'TikTok terhubung' }); });
test('halaman legal publik dapat diakses', async () => { const { app } = setup(); const terms = await request(app).get('/terms').expect(200).expect('Content-Type', /html/); assert.match(terms.text, /Terms of Service/); const privacy = await request(app).get('/privacy').expect(200).expect('Content-Type', /html/); assert.match(privacy.text, /Privacy Policy/); });
test('halaman utama menampilkan tautan legal di footer', async () => { const { app } = setup(); const r = await request(app).get('/').expect(200); assert.match(r.text, /<footer>/); assert.match(r.text, /href="\/terms"/); assert.match(r.text, /href="\/privacy"/); });
test('browser melakukan polling draft tiap 10 detik selama maksimal 5 menit dengan pesan yang tepat', () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(script, /setTimeout\(resolve, 10 \* 1000\)/);
  assert.match(script, /Date\.now\(\) - startedAt < 5 \* 60 \* 1000/);
  assert.match(script, /data\.status === 'SEND_TO_USER_INBOX'/);
  assert.match(script, /Draft berhasil dikirim\. Buka Inbox TikTok untuk melanjutkan\./);
  assert.match(script, /TikTok belum berhasil mengunduh gambar\. Periksa URL gambar dan coba lagi\./);
  assert.doesNotMatch(script, /data\.status === 'PUBLISH_COMPLETE'/);
});
test('generate menyimpan kategori dan format serta meneruskannya ke AI', async () => {
  let options;
  const content = { generateContent: async (topics, value) => { options = value; return { topic: 'Teknik Pomodoro', hook: 'Fokus', body: '- Mulai singkat\n- Istirahat', caption: 'Praktikkan', hashtags: ['#Produktivitas'], cta: 'Simpan' }; } };
  const { app } = setup({ content });
  const r = await request(app).post('/generate').send({ topicSource: 'ai', contentCategory: 'Produktivitas', contentFormat: 'Tips cepat' }).expect(200);
  assert.equal(r.body.content_category, 'Produktivitas');
  assert.equal(r.body.content_format, 'Tips cepat');
  assert.equal(options.contentCategory, 'Produktivitas');
  assert.equal(options.contentFormat, 'Tips cepat');
});
test('kategori custom wajib diisi dan nilai custom disimpan', async () => {
  const { app } = setup();
  await request(app).post('/generate').send({ contentCategory: 'Custom', contentFormat: 'Listicle' }).expect(400);
  const r = await request(app).post('/generate').send({ contentCategory: 'Custom', customCategory: '  kesehatan mental ', contentFormat: 'Listicle' }).expect(200);
  assert.equal(r.body.content_category, 'kesehatan mental');
});
test('kategori dan format yang tidak dikenal ditolak', async () => {
  const { app } = setup();
  await request(app).post('/generate').send({ contentCategory: 'Tidak valid', contentFormat: 'Listicle' }).expect(400);
  await request(app).post('/generate').send({ contentCategory: 'Motivasi', contentFormat: 'Tidak valid' }).expect(400);
});
