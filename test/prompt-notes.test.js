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

test('Auto-title strips filler verbs and produces natural short phrases', t => {
  const cases = [
    { input: 'Buat headshot yang bersih dan profesional dari foto saya', expect: /headshot/i },
    { input: 'Create a cinematic storyboard of an elegant adult woman walking', expect: /cinematic|storyboard/i },
    { input: 'Buatkan tampilan golden hour outdoor untuk katalog produk', expect: /golden hour/i },
    { input: 'Generate a DSLR-style portrait with bokeh background', expect: /DSLR|portrait/i },
    { input: 'Tolong buatkan visual editorial mewah untuk brand fashion', expect: /editorial|mewah/i },
  ];
  for (const { input, expect: pattern } of cases) {
    const title = promptNotes.autoTitle(input);
    const words = title.split(/\s+/);
    assert.ok(words.length >= 2 && words.length <= 7, `"${title}" should be 2-7 words`);
    assert.ok(!title.includes('…'), `"${title}" should not use ellipsis`);
    assert.ok(!/^(buat|create|generate|tolong|make)/i.test(title), `"${title}" should not start with a filler verb`);
    assert.match(title, pattern, `"${title}" should match ${pattern}`);
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

test('Notes frontend has list view with clickable titles and a detail view with copy/generate/delete', () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/notes.js'), 'utf8');
  for (const value of ['PROMPT NOTES', 'notes-search', 'notes-list-item', 'notes-detail-view', '/api/notes', 'aiads-image-generator-prompt', "location.hash = '#studio'"]) assert.ok(script.includes(value), `Missing: ${value}`);
  assert.match(script, /data-note-open=/);
  assert.match(script, /notes-detail-copy/);
  assert.match(script, /notes-detail-generate/);
  assert.match(script, /notes-detail-delete/);
  assert.match(script, /notes-detail-back/);
  assert.ok(!script.includes('note-card-actions'), 'List view should not have card action buttons');
  assert.match(script, /method: 'DELETE'/);
});
