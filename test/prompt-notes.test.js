const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const promptNotes = require('../src/services/promptNotes');

function fixture(t) {
  const db = createDatabase(':memory:');
  const app = express();
  app.use(express.json());
  promptNotes.install({ app, db });
  t.after(() => db.close());
  return { app, db };
}

test('Notes persist prompt text and derive a short natural title from Scene', async t => {
  const { app } = fixture(t);
  const content = '## Project\nCreate a focused advertising concept.\n\n## Scene\nYoung creator demonstrates a compact coffee grinder beside a sunny kitchen window.\n\n## Technical Notes\nAspect ratio: 9:16.';
  const saved = await request(app).post('/api/notes').send({ content, source: 'prompt-generator' }).expect(201);
  const words = saved.body.title.split(/\s+/);
  assert.ok(words.length >= 2 && words.length <= 7, `Title should be 2-7 words, got "${saved.body.title}"`);
  assert.ok(!saved.body.title.includes('…'), 'Title should not use ellipsis');
  assert.equal(saved.body.content, content);
  assert.equal(saved.body.source, 'prompt-generator');

  const listed = await request(app).get('/api/notes').expect(200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].id, saved.body.id);
  assert.equal(listed.body[0].content, content);
});

test('Auto-title produces natural short phrases, not keyword dumps', t => {
  const cases = [
    { input: 'Buat headshot yang bersih dan profesional dari foto saya', expect: /Headshot/i },
    { input: 'Create a cinematic storyboard of an elegant adult woman walking', expect: /Cinematic Storyboard/i },
    { input: 'Buatkan tampilan golden hour outdoor untuk katalog produk', expect: /Golden Hour/i },
    { input: 'Generate a DSLR-style portrait with bokeh background', expect: /DSLR.*Portrait/i },
    { input: 'Tolong buatkan visual editorial mewah untuk brand fashion', expect: /Visual Editorial Mewah/i },
    { input: 'Buat foto produk skincare premium dengan latar belakang marmer', expect: /Produk Skincare Premium/i },
    { input: 'Create a moody noir scene with dramatic shadows and rain', expect: /Moody Noir Scene/i },
    { input: 'Buat visual iklan TikTok yang eye-catching untuk brand sneakers', expect: /Visual Iklan TikTok/i },
  ];
  for (const { input, expect: pattern } of cases) {
    const title = promptNotes.autoTitle(input);
    const words = title.split(/\s+/);
    assert.ok(words.length >= 2 && words.length <= 5, `"${title}" should be 2-5 words (got ${words.length})`);
    assert.ok(!title.includes('…'), `"${title}" should not use ellipsis`);
    assert.ok(!/^(buat|create|generate|tolong|make)\b/i.test(title), `"${title}" should not start with a filler verb`);
    assert.match(title, pattern, `"${title}" should match ${pattern}`);
    assert.match(title, /^[A-Z]/, `"${title}" should start with an uppercase letter (Title Case)`);
  }
});

test('Auto-title never includes generic quality filler words', t => {
  const fillers = ['baik', 'bagus', 'indah', 'cantik', 'keren', 'mantap', 'sempurna',
                   'good', 'nice', 'great', 'beautiful', 'perfect', 'amazing', 'awesome', 'stunning'];
  const prompts = [
    'Buat gambar yang bagus dan indah untuk iklan parfum',
    'Generate a stunning beautiful portrait with soft lighting',
    'Create a nice amazing background with dramatic clouds',
    'Buatkan visual yang keren dan mantap untuk brand sepatu',
    'Buat iklan yang sempurna dan cantik untuk produk kosmetik',
  ];
  for (const input of prompts) {
    const title = promptNotes.autoTitle(input);
    const titleWords = title.toLowerCase().split(/\s+/);
    for (const filler of fillers) {
      assert.ok(!titleWords.includes(filler), `"${title}" should not contain filler word "${filler}"`);
    }
  }
});

test('Auto-title keeps language consistent: Indonesian prompt -> Indonesian title', t => {
  const idCases = [
    'Buatkan tampilan golden hour outdoor untuk katalog produk',
    'Buat visual iklan TikTok yang eye-catching untuk brand sneakers',
    'Tolong buatkan visual editorial mewah untuk brand fashion',
  ];
  for (const input of idCases) {
    const title = promptNotes.autoTitle(input);
    assert.ok(!/\b(scene|portrait|background|dramatic|elegant)\b/i.test(title),
      `Indonesian prompt should not produce English-only words in title: "${title}"`);
  }
});

test('Auto-title keeps language consistent: English prompt -> English title', t => {
  const enCases = [
    'Generate a DSLR-style portrait with bokeh background',
    'Create a moody noir scene with dramatic shadows and rain',
    'Create cinematic slow-motion video of coffee being poured',
  ];
  for (const input of enCases) {
    const title = promptNotes.autoTitle(input);
    assert.ok(!/\b(baik|bagus|indah|cantik|keren|tampilan|iklan|produk)\b/i.test(title),
      `English prompt should not produce Indonesian words in title: "${title}"`);
  }
});

test('Auto-title preserves brand names and acronyms', t => {
  const cases = [
    { input: 'Buat visual iklan TikTok yang eye-catching', expect: 'TikTok' },
    { input: 'Generate a DSLR-style portrait with bokeh', expect: 'DSLR' },
    { input: 'Create an ad for iPhone 15 Pro Max', expect: 'iPhone' },
  ];
  for (const { input, expect: brand } of cases) {
    const title = promptNotes.autoTitle(input);
    assert.ok(title.includes(brand), `"${title}" should preserve "${brand}"`);
  }
});

test('Notes reject empty prompts, support search, and can be deleted', async t => {
  const { app } = fixture(t);
  await request(app).post('/api/notes').send({ content: '   ' }).expect(422);
  const saved = await request(app).post('/api/notes').send({ content: '## Scene\nPremium red sneaker rotating on a clean studio pedestal.' }).expect(201);
  const match = await request(app).get('/api/notes?search=sneaker').expect(200);
  assert.equal(match.body.length, 1);
  const miss = await request(app).get('/api/notes?search=coffee').expect(200);
  assert.equal(miss.body.length, 0);
  await request(app).delete(`/api/notes/${saved.body.id}`).expect(200);
  assert.deepEqual((await request(app).get('/api/notes').expect(200)).body, []);
});

test('Notes title can be renamed from detail view API', async t => {
  const { app } = fixture(t);
  const saved = await request(app).post('/api/notes').send({ content: '## Scene\nPremium red sneaker rotating on a clean studio pedestal.' }).expect(201);
  const updated = await request(app).patch(`/api/notes/${saved.body.id}`).send({ title: 'Judul Baru Notes' }).expect(200);
  assert.equal(updated.body.title, 'Judul Baru Notes');
  assert.equal(updated.body.content, saved.body.content);
  await request(app).patch(`/api/notes/${saved.body.id}`).send({ title: '   ' }).expect(422);
});


test('Notes frontend has list view with clickable titles and a detail view with copy/generate/delete', () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/notes.js'), 'utf8');
  for (const value of ['notes-search', 'notes-list-item', 'notes-detail-view', '/api/notes', 'aiads-image-generator-prompt', "location.hash = '#studio'"]) assert.ok(script.includes(value), `Missing: ${value}`);
  assert.ok(!script.includes('PROMPT NOTES'), 'Header should not contain the old PROMPT NOTES eyebrow');
  assert.ok(!script.includes('tersusun rapi di VPS'), 'Header should not contain old description text');
  assert.ok(!script.includes('tersinkron dengan VPS'), 'Status should not show VPS sync message');
  assert.match(script, /data-note-open=/);
  assert.match(script, /notes-detail-copy/);
  assert.match(script, /notes-detail-generate/);
  assert.match(script, /notes-detail-delete/);
  assert.match(script, /notes-detail-back/);
  assert.match(script, /notes-detail-edit-title/);
  assert.match(script, /Edit judul Notes/);
  assert.match(script, /method: 'PATCH'/);
  assert.ok(!script.includes('note-card-actions'), 'List view should not have card action buttons');
  assert.match(script, /method: 'DELETE'/);
});
