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

test('Notes persist prompt text and automatically derive a useful title from Scene', async t => {
  const { app } = fixture(t);
  const content = '## Project\nCreate a focused advertising concept.\n\n## Scene\nYoung creator demonstrates a compact coffee grinder beside a sunny kitchen window.\n\n## Technical Notes\nAspect ratio: 9:16.';
  const saved = await request(app).post('/api/notes').send({ content, source: 'prompt-generator' }).expect(201);
  assert.equal(saved.body.title, 'Young creator demonstrates a compact coffee grinder beside a sunny');
  assert.equal(saved.body.content, content);
  assert.equal(saved.body.source, 'prompt-generator');

  const listed = await request(app).get('/api/notes').expect(200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].id, saved.body.id);
  assert.equal(listed.body[0].content, content);
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

test('Notes frontend renders saved prompts with copy, generate, delete, search, and VPS API wiring', () => {
  const script = fs.readFileSync(path.join(__dirname, '../public/notes.js'), 'utf8');
  for (const value of ['PROMPT NOTES', 'notes-search', 'Copy', 'Generate', 'Hapus', '/api/notes', 'aiads-image-generator-prompt', "location.hash = '#studio'"]) assert.ok(script.includes(value), value);
  assert.match(script, /data-note-action="copy"/);
  assert.match(script, /data-note-action="generate"/);
  assert.match(script, /data-note-action="delete"/);
});
