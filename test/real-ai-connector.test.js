const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { ProviderFactory } = require('../src/providers');

const response = body => ({ ok: true, status: 200, headers: { get: () => 'test-v1' }, json: async () => body, text: async () => JSON.stringify(body) });
function setup(transport = async () => response({ output: 'Generated ad', usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } })) { const db = createDatabase(':memory:'); return { db, app: createApp({ db, aiTransport: transport }) }; }

test('factory registers every Milestone 11 provider behind one adapter contract', () => {
  assert.deepEqual(ProviderFactory.names(), ['9router','orcarouter','google-flow','google-veo','google-imagen','google-gemini','openai-images','vidu','omni']);
  for (const provider of ProviderFactory.names()) { const defaults = ProviderFactory.defaults(provider); const adapter = ProviderFactory.create({ provider, base_url: defaults.baseUrl, default_model: defaults.model, api_key: 'secret' }, async () => response({})); for (const method of ['buildRequest','execute','parse','testConnection']) assert.equal(typeof adapter[method], 'function'); }
});

test('credentials remain encrypted and API responses only expose a fixed mask', async () => {
  const { db, app } = setup();
  const saved = await request(app).put('/api/ai/providers/openai-images').send({ apiKey: 'sk-private-value', enabled: true, region: 'us-east', retry: 1 });
  assert.equal(saved.status, 200); assert.equal(saved.body.apiKey, '••••••••'); assert.equal(saved.body.hasApiKey, true); assert.doesNotMatch(JSON.stringify(saved.body), /sk-private-value/);
  const stored = db.prepare("SELECT api_key_encrypted FROM ai_provider_settings WHERE provider='openai-images'").get(); assert.doesNotMatch(stored.api_key_encrypted, /sk-private-value/);
});

test('connection test and execution persist health, lifecycle result, and usage', async () => {
  const { db, app } = setup(); await request(app).put('/api/ai/providers/openai-images').send({ apiKey: 'secret', enabled: true });
  const checked = await request(app).post('/api/ai/providers/openai-images/test'); assert.equal(checked.status, 200); assert.equal(checked.body.connected, true);
  const generated = await request(app).post('/api/ai/generations').send({ provider: 'openai-images', prompt: 'Create a concise ad' }); assert.equal(generated.status, 202); assert.equal(generated.body.status, 'Completed'); assert.equal(generated.body.total_tokens, 6); assert.equal(generated.body.output, 'Generated ad');
  assert.equal(db.prepare("SELECT status FROM ai_provider_health WHERE provider='openai-images'").get().status, 'Online');
});
