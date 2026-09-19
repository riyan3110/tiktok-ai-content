// Real HTTP only. Valid-provider tests require isolated test credentials in the environment.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
const express = require('express');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const dynamic = require('../src/services/dynamicAiProviders');
const live = process.env.AIADS_RUN_LIVE_TESTS === '1';
const configured = ['AIADS_TEST_TEXT_URL', 'AIADS_TEST_TEXT_KEY', 'AIADS_TEST_SECOND_URL', 'AIADS_TEST_SECOND_KEY'].every(key => process.env[key]);
function fixture(t) {
  const db = createDatabase(':memory:'); t.after(() => db.close());
  const app = express(); app.use(express.json());
  const calls = [];
  const transport = (url, options) => { calls.push({ url, method: options?.method || 'GET' }); return fetch(url, options); };
  dynamic.install({ app, db, transport });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  return { db, app, calls };
}

test('LIVE: a rejected real API key is not saved', { skip: !live, timeout: 30000 }, async t => {
  const { app, db } = fixture(t);
  const result = await request(app).post('/api/dynamic-ai/providers').send({ baseUrl: 'https://api.openai.com/v1', apiKey: `invalid-${crypto.randomUUID()}`, role: 'text' });
  assert.ok([401, 403].includes(result.status), `Expected remote authentication rejection, received HTTP ${result.status}`);
  assert.equal(dynamic.publicState(db).providers.length, 0);
});

test('LIVE A–F: discovery, generation, fallback and deletion with two actual Text providers', { skip: !live || !configured, timeout: 300000 }, async t => {
  const { app, db, calls } = fixture(t);
  let a, b;
  await t.test('A: save verified providers and discover catalogs', async () => {
    a = (await request(app).post('/api/dynamic-ai/providers').send({ baseUrl: process.env.AIADS_TEST_TEXT_URL, apiKey: process.env.AIADS_TEST_TEXT_KEY, role: 'text' }).expect(201)).body.saved;
    b = (await request(app).post('/api/dynamic-ai/providers').send({ baseUrl: process.env.AIADS_TEST_SECOND_URL, apiKey: process.env.AIADS_TEST_SECOND_KEY, role: 'text' }).expect(201)).body.saved;
    assert.ok(a.models.length && b.models.length);
    assert.notEqual(a.id, b.id);
    dynamic.setDefault(db, 'text', b.id, process.env.AIADS_TEST_SECOND_MODEL || b.model);
    dynamic.setDefault(db, 'text', a.id, process.env.AIADS_TEST_TEXT_MODEL || a.model);
  });
  if (!a || !b) return;
  await t.test('B: selected provider answers a real prompt', async () => {
    const result = await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'Jawab singkat: berapa 2 + 2?' }).expect(200);
    assert.equal(result.body.providerId, a.id); assert.ok(result.body.text); assert.ok(result.body.model);
  });
  const original = db.prepare('SELECT base_url FROM ai_dynamic_provider_profiles WHERE id=?').get(a.id).base_url;
  // A closed local TCP port is a real network failure, not a simulated provider response.
  db.prepare('UPDATE ai_dynamic_provider_profiles SET base_url=? WHERE id=?').run('http://127.0.0.1:1/v1', a.id);
  await t.test('C: fallback OFF never sends to B', async () => {
    calls.length = 0;
    await request(app).put('/api/dynamic-ai/fallback').send({ role: 'text', enabled: false }).expect(200);
    await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'Jawab 4.' }).expect(502);
    assert.ok(calls.length > 0); assert.ok(calls.every(call => call.url.startsWith('http://127.0.0.1:1/')));
  });
  await t.test('D: fallback ON reaches B and reports B', async () => {
    calls.length = 0;
    await request(app).put('/api/dynamic-ai/fallback').send({ role: 'text', enabled: true }).expect(200);
    const result = await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'Jawab singkat: 2 + 2?' }).expect(200);
    assert.equal(result.body.providerId, b.id); assert.ok(result.body.text);
    assert.ok(calls[0].url.startsWith('http://127.0.0.1:1/'));
  });
  db.prepare('UPDATE ai_dynamic_provider_profiles SET base_url=? WHERE id=?').run(original, a.id);
  await t.test('E: deleted provider stays absent after reload; process persistence is tested separately', async () => {
    await request(app).delete(`/api/dynamic-ai/providers/${a.id}`).expect(200);
    const result = await request(app).get('/api/dynamic-ai/providers').expect(200);
    assert.ok(result.body.providers.every(row => row.id !== a.id));
  });
  await t.test('F: deleted provider is never attempted', async () => {
    calls.length = 0;
    const result = await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'Jawab singkat: 2 + 2?' }).expect(200);
    assert.equal(result.body.providerId, b.id);
    assert.ok(calls.every(call => !call.url.startsWith(original)));
  });
});
