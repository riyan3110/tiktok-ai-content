// HTTP contract tests use the existing injected transport; these are not live acceptance tests.
process.env.SESSION_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { install } = require('../src/services/dynamicAiProviders');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function fixture() {
  const db = createDatabase(':memory:');
  const calls = [];
  const transport = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || 'GET' });
    if (String(options.headers?.Authorization || '').startsWith('Bearer invalid-')) return jsonResponse({ error: 'invalid key' }, 401);

    if (target.endsWith('/models')) {
      if (target.includes('one.local')) return jsonResponse({ data: [{ id: 'one-a' }, { id: 'one-b' }] });
      if (target.includes('two.local')) return jsonResponse({ data: [{ id: 'two-a' }, { id: 'two-b' }] });
    }

    if (target.includes('one.local') && target.endsWith('/chat/completions')) {
      return jsonResponse({ error: 'provider one failed' }, 500);
    }
    if (target.includes('two.local') && target.endsWith('/chat/completions')) {
      return jsonResponse({
        choices: [{ message: { content: 'jawaban dari provider dua' } }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }
      });
    }
    return jsonResponse({ error: `unexpected ${target}` }, 404);
  };

  const app = express();
  app.use(express.json());
  install({ app, db, transport });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(Number(error?.status) || 500).json({ error: error?.message || 'error' });
  });
  return { db, app, calls };
}

test('save verifies model catalog, provider/model selection persists, delete is root-clean', async () => {
  const { app } = fixture();

  const savedOne = await request(app).post('/api/dynamic-ai/providers').send({
    baseUrl: 'https://one.local/v1', apiKey: 'secret-one'
  }).expect(201);
  assert.deepEqual(savedOne.body.saved.models, ['one-a', 'one-b']);
  assert.equal(savedOne.body.saved.model, 'one-a');

  await request(app).post(`/api/dynamic-ai/providers/${savedOne.body.saved.id}/model`)
    .send({ model: 'one-b' }).expect(200);

  const stateAfterModel = await request(app).get('/api/dynamic-ai/providers').expect(200);
  assert.equal(stateAfterModel.body.providers[0].model, 'one-b');
  assert.equal(stateAfterModel.body.providers[0].apiKey, undefined);
  assert.equal(stateAfterModel.body.providers[0].hasApiKey, true);

  await request(app).delete(`/api/dynamic-ai/providers/${savedOne.body.saved.id}`).expect(200);
  const afterDelete = await request(app).get('/api/dynamic-ai/providers').expect(200);
  assert.equal(afterDelete.body.providers.length, 0);
  assert.equal(afterDelete.body.selectedProviderId, null);
});

test('fallback off uses only selected provider; fallback on uses only remaining saved providers', async () => {
  const { app, calls } = fixture();

  const one = (await request(app).post('/api/dynamic-ai/providers').send({
    baseUrl: 'https://one.local/v1', apiKey: 'secret-one'
  }).expect(201)).body.saved;
  const two = (await request(app).post('/api/dynamic-ai/providers').send({
    baseUrl: 'https://two.local/v1', apiKey: 'secret-two'
  }).expect(201)).body.saved;

  await request(app).post(`/api/dynamic-ai/providers/${one.id}/select`).send({}).expect(200);

  const failed = await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'tes' }).expect(502);
  assert.match(failed.body.error, /One/i);
  assert.equal(calls.filter(call => call.url.endsWith('/chat/completions')).at(-1).url.includes('one.local'), true);

  await request(app).put('/api/dynamic-ai/fallback').send({ enabled: true }).expect(200);
  const generated = await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'tes fallback' }).expect(200);
  assert.equal(generated.body.providerId, two.id);
  assert.equal(generated.body.model, 'two-a');
  assert.equal(generated.body.text, 'jawaban dari provider dua');

  await request(app).delete(`/api/dynamic-ai/providers/${one.id}`).expect(200);
  const before = calls.length;
  const generatedAfterDelete = await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'setelah hapus' }).expect(200);
  assert.equal(generatedAfterDelete.body.providerId, two.id);
  const newCalls = calls.slice(before).filter(call => call.url.endsWith('/chat/completions'));
  assert.equal(newCalls.some(call => call.url.includes('one.local')), false);
});

test('the same URL stores independent Text and Image credentials, models and selections', async () => {
  const { app, db } = fixture();
  const text = (await request(app).post('/api/dynamic-ai/providers').send({ role: 'text', baseUrl: 'https://two.local/v1', apiKey: 'text-only-key' }).expect(201)).body.saved;
  await request(app).put('/api/dynamic-ai/defaults/text').send({ providerId: text.id, model: 'two-b' }).expect(200);
  const before = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(text.id);
  const image = (await request(app).post('/api/dynamic-ai/providers').send({ role: 'image', baseUrl: 'https://two.local/v1', apiKey: 'image-only-key' }).expect(201)).body.saved;
  assert.notEqual(text.id, image.id);
  const textRow = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(text.id);
  const imageRow = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(image.id);
  assert.equal(textRow.api_key_encrypted, before.api_key_encrypted);
  assert.notEqual(textRow.api_key_encrypted, imageRow.api_key_encrypted);
  assert.match(textRow.api_key_encrypted, /^v2\./);
  assert.equal(textRow.selected_text_model, 'two-b');
  const state = (await request(app).get('/api/dynamic-ai/providers').expect(200)).body;
  assert.equal(state.defaults.text.providerId, text.id);
  assert.equal(state.defaults.image.providerId, image.id);
  await request(app).delete(`/api/dynamic-ai/providers/${image.id}`).expect(200);
  const remaining = (await request(app).get('/api/dynamic-ai/providers').expect(200)).body;
  assert.equal(remaining.defaults.text.providerId, text.id);
  assert.equal(remaining.defaults.text.model, 'two-b');
  assert.equal(remaining.defaults.image.providerId, null);
});
