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
