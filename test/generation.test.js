const test = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const {
  generateAndSave,
  normalizeTopic,
  isDuplicate,
  MAX_GENERATION_ATTEMPTS
} = require('../src/services/generation');

const generatedContent = (topic) => ({
  topic,
  hook: 'Hook',
  body: '1. Langkah',
  caption: 'Caption',
  hashtags: ['#AI'],
  cta: 'Coba'
});

const similarContent = topic => ({
  ...generatedContent(topic),
  content_angle: 'workflow riset sumber',
  primary_tool: 'Perplexity',
  hook_pattern: 'hemat waktu',
  hook: 'Hemat waktu riset sumber',
  body: 'Cari sumber lalu verifikasi fakta',
  cta: 'Simpan panduan ini'
});

function insertSimilarHistory(db, topic = 'Riwayat riset') {
  const item = similarContent(topic);
  db.prepare('INSERT INTO contents(topic,content_angle,primary_tool,hook_pattern,hook,body,caption,hashtags,cta) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(item.topic, item.content_angle, item.primary_tool, item.hook_pattern, item.hook, item.body, item.caption, '[]', item.cta);
}

const fakeImages = { createSlides: async () => ['/generated/slide.jpg'] };
const fakeSourceFetcher = {
  validateSourceUrls: urls => urls,
  fetchSources: async urls => [{ url: urls[0], finalUrl: urls[0], title: 'Sumber', text: 'Fakta sumber yang relevan.', fetchedAt: '2026-08-08T00:00:00.000Z' }],
  buildSourceContext: () => '<SOURCE id="source-1">Fakta sumber yang relevan.</SOURCE>'
};

function insertTopic(db, topic) {
  db.prepare('INSERT INTO contents(topic,hook,body,caption,hashtags,cta) VALUES(?,?,?,?,?,?)')
    .run(topic, 'Hook', 'Body', 'Caption', '[]', 'CTA');
}

test('normalizeTopic mengabaikan kapital, spasi berlebih, dan whitespace', () => {
  assert.equal(normalizeTopic('  STORYBOARD\n\t  AI  '), 'storyboard ai');
  assert.equal(normalizeTopic(null), '');
});

test('isDuplicate membandingkan bentuk topic yang sudah dinormalisasi', () => {
  const db = createDatabase(':memory:');
  insertTopic(db, 'Storyboard AI');

  assert.equal(isDuplicate(db, '  STORYBOARD   ai '), true);
  assert.equal(isDuplicate(db, 'Topik berbeda'), false);
  db.close();
});

test('generateAndSave mencoba ulang topic duplikat maksimal tiga kali', async () => {
  const db = createDatabase(':memory:');
  insertTopic(db, 'Storyboard AI');
  let calls = 0;
  const content = {
    generateContent: async () => {
      calls += 1;
      return generatedContent('  STORYBOARD   ai ');
    }
  };

  await assert.rejects(
    generateAndSave({
      db,
      content,
      images: { createSlides: async () => [] }
    }),
    (error) => error.status === 409 && /3 percobaan/.test(error.message)
  );
  assert.equal(calls, MAX_GENERATION_ATTEMPTS);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM contents').get().count, 1);
  db.close();
});

test('generateAndSave menyimpan hasil unik dari retry sebelum batas tiga kali', async () => {
  const db = createDatabase(':memory:');
  insertTopic(db, 'Storyboard AI');
  let calls = 0;
  const topics = ['storyboard ai', '  STORYBOARD AI  ', 'Topik Unik'];
  const id = await generateAndSave({
    db,
    content: { generateContent: async () => generatedContent(topics[calls++]) },
    images: { createSlides: async () => ['/generated/slide.jpg'] }
  });

  assert.equal(calls, MAX_GENERATION_ATTEMPTS);
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Topik Unik');
  db.close();
});

test('mode manual menerima similarity tinggi dan tetap menyimpan similarity_score', async () => {
  const db = createDatabase(':memory:');
  insertSimilarHistory(db);
  let calls = 0;
  const id = await generateAndSave({
    db,
    mode: 'manual',
    requestedTopic: 'Riset Meta terbaru',
    content: { generateContent: async () => { calls += 1; return similarContent('Riset Meta terbaru'); } },
    images: fakeImages
  });

  const saved = db.prepare('SELECT similarity_score FROM contents WHERE id=?').get(id);
  assert.equal(calls, 1);
  assert.ok(saved.similarity_score > 0.55);
  db.close();
});

test('manual dengan source URL menerima similarity tinggi tanpa retry', async () => {
  const db = createDatabase(':memory:');
  insertSimilarHistory(db);
  let calls = 0;
  const id = await generateAndSave({
    db,
    mode: 'manual',
    requestedTopic: 'Ethan dari sumber baru',
    useSources: true,
    sourceUrls: ['https://example.com/ethan'],
    sourceFetcher: fakeSourceFetcher,
    content: { generateContent: async () => { calls += 1; return similarContent('Ethan dari sumber baru'); } },
    images: fakeImages
  });

  assert.equal(calls, 1);
  assert.ok(db.prepare('SELECT similarity_score FROM contents WHERE id=?').get(id).similarity_score > 0.55);
  db.close();
});

test('mode AI tetap melakukan retry anti-duplikat saat similarity tinggi', async () => {
  const db = createDatabase(':memory:');
  insertSimilarHistory(db);
  let calls = 0;
  await assert.rejects(generateAndSave({
    db,
    content: { generateContent: async () => { calls += 1; return similarContent(`Riset AI ${calls}`); } },
    images: fakeImages
  }), error => error.status === 422);
  assert.equal(calls, MAX_GENERATION_ATTEMPTS);
  db.close();
});

test('mode trending tetap melakukan retry anti-duplikat saat similarity tinggi', async () => {
  const db = createDatabase(':memory:');
  insertSimilarHistory(db);
  let calls = 0;
  await assert.rejects(generateAndSave({
    db,
    mode: 'trending',
    trending: { getLatest: async () => ['Tren baru'] },
    content: { generateContent: async () => { calls += 1; return similarContent(`Tren hasil ${calls}`); } },
    images: fakeImages
  }), error => error.status === 422);
  assert.equal(calls, MAX_GENERATION_ATTEMPTS);
  db.close();
});

test('exact duplicate topic manual tetap ditolak sebelum memanggil AI', async () => {
  const db = createDatabase(':memory:');
  insertTopic(db, 'Meta');
  let calls = 0;
  await assert.rejects(generateAndSave({
    db,
    mode: 'manual',
    requestedTopic: ' meta ',
    content: { generateContent: async () => { calls += 1; return generatedContent('Meta'); } },
    images: fakeImages
  }), error => error.status === 409);
  assert.equal(calls, 0);
  db.close();
});

test('forceNewAngle manual meminta variasi tetapi similarity tidak menjadi hard failure', async () => {
  const db = createDatabase(':memory:');
  insertSimilarHistory(db);
  const options = [];
  const id = await generateAndSave({
    db,
    mode: 'manual',
    requestedTopic: 'Meta dengan angle pilihan',
    forceNewAngle: true,
    content: { generateContent: async (_used, received) => { options.push(received); return similarContent('Meta dengan angle pilihan'); } },
    images: fakeImages
  });

  assert.equal(options.length, 1);
  assert.match(options[0].rejectedAngle, /pilih kandidat lain/i);
  assert.ok(db.prepare('SELECT similarity_score FROM contents WHERE id=?').get(id).similarity_score > 0.55);
  db.close();
});
