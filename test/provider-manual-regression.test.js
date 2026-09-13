process.env.SESSION_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const dynamic = require('../src/services/dynamicAiProviders');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function fixture(t) {
  const db = createDatabase(':memory:');
  const calls = [];
  let catalog = ['old-a', 'old-b'];
  const transport = async (url, options = {}) => {
    const target = String(url);
    const authorization = String(options.headers?.Authorization || '');
    calls.push({ url: target, method: options.method || 'GET', authorization, body: options.body });

    if (authorization === 'Bearer rejected-key' || authorization.startsWith('Bearer invalid-')) {
      return jsonResponse({ error: 'invalid key' }, 401);
    }
    if (target.endsWith('/models')) return jsonResponse({ data: catalog.map(id => ({ id })) });
    if (target.endsWith('/chat/completions')) {
      const body = JSON.parse(options.body || '{}');
      return jsonResponse({ model: body.model, choices: [{ message: { content: `reply:${body.model}` } }] });
    }
    if (target.endsWith('/images/generations')) {
      const body = JSON.parse(options.body || '{}');
      return jsonResponse({ model: body.model, data: [{ url: `https://images.invalid/${body.model}.png` }] });
    }
    return jsonResponse({ error: `unexpected ${target}` }, 404);
  };

  const app = express();
  app.use(express.json());
  dynamic.install({ app, db, transport });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  t.after(() => db.close());
  return { db, app, calls, setCatalog: models => { catalog = [...models]; } };
}

test('rejected API key never creates a provider or cached model', async t => {
  const { app, db } = fixture(t);
  await request(app).post('/api/dynamic-ai/providers').send({
    role: 'text', baseUrl: 'https://manual.local/v1', apiKey: 'rejected-key'
  }).expect(401);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ai_dynamic_provider_profiles').get().total, 0);
  assert.deepEqual(dynamic.publicState(db).providers, []);
});

test('resaving the same provider replaces stale catalog and stale selected model', async t => {
  const { app, db, setCatalog } = fixture(t);
  const saved = (await request(app).post('/api/dynamic-ai/providers').send({
    role: 'text', baseUrl: 'https://manual.local/v1', apiKey: 'live-key'
  }).expect(201)).body.saved;
  await request(app).put('/api/dynamic-ai/defaults/text').send({ providerId: saved.id, model: 'old-b' }).expect(200);

  setCatalog(['fresh-a', 'fresh-b']);
  const refreshed = await request(app).post('/api/dynamic-ai/providers').send({
    role: 'text', baseUrl: 'https://manual.local/v1', apiKey: 'live-key'
  }).expect(200);

  assert.deepEqual(refreshed.body.saved.models, ['fresh-a', 'fresh-b']);
  assert.equal(refreshed.body.defaults.text.model, 'fresh-a');
  assert.equal(JSON.stringify(refreshed.body).includes('old-b'), false);
  const row = db.prepare('SELECT models_json,selected_text_model FROM ai_dynamic_provider_profiles WHERE id=?').get(saved.id);
  assert.deepEqual(JSON.parse(row.models_json), ['fresh-a', 'fresh-b']);
  assert.equal(row.selected_text_model, 'fresh-a');
});

test('text generation sends the provider and model selected from the verified live catalog', async t => {
  const { app, calls, setCatalog } = fixture(t);
  setCatalog(['text-a', 'text-b']);
  const saved = (await request(app).post('/api/dynamic-ai/providers').send({
    role: 'text', baseUrl: 'https://manual.local/v1', apiKey: 'live-key'
  }).expect(201)).body.saved;
  await request(app).put('/api/dynamic-ai/defaults/text').send({ providerId: saved.id, model: 'text-b' }).expect(200);

  const result = await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'tes provider manual' }).expect(200);
  assert.equal(result.body.providerId, saved.id);
  assert.equal(result.body.model, 'text-b');
  assert.equal(result.body.text, 'reply:text-b');
  const generation = calls.filter(call => call.url.endsWith('/chat/completions')).at(-1);
  assert.equal(JSON.parse(generation.body).model, 'text-b');
  assert.equal(generation.authorization, 'Bearer live-key');
});

test('image generation keeps an independent provider credential and selected image model', async t => {
  const { app, calls, setCatalog } = fixture(t);
  setCatalog(['image-a', 'image-b']);
  const saved = (await request(app).post('/api/dynamic-ai/providers').send({
    role: 'image', baseUrl: 'https://manual.local/v1', apiKey: 'image-key'
  }).expect(201)).body.saved;
  await request(app).put('/api/dynamic-ai/defaults/image').send({ providerId: saved.id, model: 'image-b' }).expect(200);

  const result = await request(app).post('/api/dynamic-ai/generate-image').send({ prompt: 'gambar tes' }).expect(200);
  assert.equal(result.body.providerId, saved.id);
  assert.equal(result.body.model, 'image-b');
  assert.equal(result.body.url, 'https://images.invalid/image-b.png');
  const generation = calls.filter(call => call.url.endsWith('/images/generations')).at(-1);
  assert.equal(JSON.parse(generation.body).model, 'image-b');
  assert.equal(generation.authorization, 'Bearer image-key');
});
