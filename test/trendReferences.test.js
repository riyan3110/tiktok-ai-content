const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { normalizeKeywords, normalizeHooks } = require('../src/services/trendReferences');

const contentResult = (options) => ({ topic: 'Konten Tren', hook: 'Hook', body: 'Isi', caption: 'Caption', hashtags: [], cta: 'CTA', trendKeywordsUsed: options.trendReference ? ['#AI'] : [] });
function setup() { const db = createDatabase(':memory:'); return { db, app: createApp({ db, content: { generateContent: async (_, options) => contentResult(options) }, images: { createSlides: async () => [] } }) }; }

test('normalisasi keyword membuang duplikat, spasi, input kosong, dan hashtag ganda', () => {
  assert.deepEqual(normalizeKeywords('  ##AI , ai\n UMKM  , '), ['#AI', 'UMKM']);
});

test('gaya hook disimpan per baris dan pola konten divalidasi terpisah', async () => {
  const { app } = setup();
  assert.deepEqual(normalizeHooks(' Ternyata selama ini... \n\n Cara paling gampang untuk... '), ['Ternyata selama ini...', 'Cara paling gampang untuk...']);
  const saved = await request(app).post('/trend-references').send({ keywords: '#AI', trend_hooks: 'Ternyata selama ini...\nCara paling gampang untuk...', trend_content_patterns: ['Tutorial langkah', 'Storytelling'], source: 'Google Trends' }).expect(201);
  assert.deepEqual(saved.body.trend_hooks, ['Ternyata selama ini...', 'Cara paling gampang untuk...']);
  assert.deepEqual(saved.body.trend_content_patterns, ['Tutorial langkah', 'Storytelling']);
  await request(app).post('/trend-references').send({ keywords: '#AI', trend_hooks: Array.from({ length: 16 }, (_, i) => `Hook ${i}`).join('\n'), trend_content_patterns: [], source: 'Google Trends' }).expect(400);
  await request(app).post('/trend-references').send({ keywords: '#AI', trend_content_patterns: ['Pola palsu'], source: 'Google Trends' }).expect(400);
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

test('keyword dari beberapa kategori diparsing dan hasil terpilih serta diabaikan disimpan', async () => {
  const db = createDatabase(':memory:');
  let received;
  const content = { generateContent: async (_, options) => { received = options; return { topic: 'Tidur Lebih Teratur', hook: 'Hook', body: 'Isi', caption: 'Caption', hashtags: [], cta: 'CTA', trendKeywordsUsed: ['tidur cukup'] }; } };
  const app = createApp({ db, content, images: { createSlides: async () => [] } });
  const keywords = '[TEKNOLOGI]\nAI tools\ntutorial AI\n\n[KESEHATAN]\ntidur cukup\npola hidup sehat\n\n[KEHIDUPAN]\nself improvement\nmanajemen waktu';
  const saved = await request(app).post('/trend-references').send({ keywords, source: 'Google Trends' }).expect(201);
  assert.deepEqual(saved.body.keyword_categories.slice(0, 3), [
    { category: 'TEKNOLOGI', keyword: 'AI tools' },
    { category: 'TEKNOLOGI', keyword: 'tutorial AI' },
    { category: 'KESEHATAN', keyword: 'tidur cukup' }
  ]);
  const generated = await request(app).post('/generate').send({ topicSource: 'manual', requestedTopic: 'Cara tidur cukup', contentCategory: 'Custom', customCategory: 'Kesehatan' }).expect(200);
  assert.equal(received.trendReference.keyword_categories[2].category, 'KESEHATAN');
  assert.deepEqual(generated.body.trend_keywords_used, ['tidur cukup']);
  assert.deepEqual(generated.body.trend_keywords_ignored, ['AI tools', 'tutorial AI', 'pola hidup sehat', 'self improvement', 'manajemen waktu']);
});
