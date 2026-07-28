const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

function setup() {
  const db = createDatabase(':memory:');
  const content = { generateContent: async (topics) => ({ topic: topics.length ? 'Topik Baru' : 'Storyboard AI', hook: 'Hook kuat', body: '1. Tulis brief\n2. Buat visual', caption: 'Coba cara ini', hashtags: ['#AIAds'], cta: 'Simpan dan ikuti' }) };
  const images = { createSlides: async (id) => [`/generated/${id}-1.png`, `/generated/${id}-2.png`, `/generated/${id}-3.png`] };
  const tiktok = { randomState: () => 'state', authorizationUrl: () => 'https://example.com/oauth', publishPhotos: async () => ({ data: { publish_id: 'pub-1' } }), status: async () => ({ data: { status: 'PUBLISH_COMPLETE' } }) };
  return { db, app: createApp({ db, content, images, tiktok }) };
}
test('generate menyimpan struktur konten dan tiga slide', async () => { const { app } = setup(); const r = await request(app).post('/generate').expect(200); assert.equal(r.body.topic, 'Storyboard AI'); assert.equal(r.body.slides.length, 3); assert.deepEqual(r.body.hashtags, ['#AIAds']); });
test('history mengembalikan konten terbaru', async () => { const { app } = setup(); await request(app).post('/generate'); const r = await request(app).get('/history').expect(200); assert.equal(r.body.length, 1); });
test('upload ditolak bila OAuth belum terhubung', async () => { const { app } = setup(); const c = await request(app).post('/generate'); const r = await request(app).post('/upload-tiktok').send({ id: c.body.id }).expect(401); assert.match(r.body.error, /Hubungkan/); });
test('OAuth dimulai dengan redirect', async () => { const { app } = setup(); await request(app).get('/auth/tiktok').expect(302).expect('Location', 'https://example.com/oauth'); });
