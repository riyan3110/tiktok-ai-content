const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { normalizeKeywords } = require('../src/services/trendReferences');

const contentResult = (options) => ({ topic: 'Konten Tren', hook: 'Hook', body: 'Isi', caption: 'Caption', hashtags: [], cta: 'CTA', trendKeywordsUsed: options.trendReference ? ['#AI'] : [] });
function setup() { const db = createDatabase(':memory:'); return { db, app: createApp({ db, content: { generateContent: async (_, options) => contentResult(options) }, images: { createSlides: async () => [] } }) }; }

test('normalisasi keyword membuang duplikat, spasi, input kosong, dan hashtag ganda', () => {
  assert.deepEqual(normalizeKeywords('  ##AI , ai\n UMKM  , '), ['#AI', 'UMKM']);
});

test('referensi aktif otomatis diteruskan dan keyword yang dipakai tersimpan', async () => {
  const { app, db } = setup();
  const saved = await request(app).post('/trend-references').send({ keywords: '#AI, UMKM', source: 'Google Trends', region: 'Indonesia', intensity: 'Sedang', validity: '24h' }).expect(201);
  const generated = await request(app).post('/generate').send({ useTrendReference: true }).expect(200);
  assert.equal(generated.body.trend_reference_id, saved.body.id);
  assert.deepEqual(generated.body.trend_keywords_used, ['#AI']);
  assert.equal(db.prepare('SELECT trend_reference_id FROM contents').get().trend_reference_id, saved.body.id);
});

test('referensi kedaluwarsa dan pilihan nonaktif per konten tidak digunakan', async () => {
  const { app, db } = setup();
  db.prepare("INSERT INTO trend_reference_sets(keywords,source,region,intensity,fetched_at,expires_at) VALUES('[]','Instagram','Indonesia','Sedang',?,?)").run(new Date(0).toISOString(), new Date(1).toISOString());
  const current = await request(app).get('/trend-references/current').expect(200);
  assert.equal(current.body.status, 'Sudah kedaluwarsa'); assert.equal(current.body.usable, false);
  const generated = await request(app).post('/generate').send({ useTrendReference: false }).expect(200);
  assert.equal(generated.body.trend_reference_id, null);
});
