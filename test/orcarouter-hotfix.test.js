const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { ProviderFactory } = require('../src/providers');
const connector = require('../src/ai/connector');

test('factory registers OrcaRouter and rejects unknown IDs', () => {
  assert.ok(ProviderFactory.names().includes('orcarouter'));
  assert.throws(() => ProviderFactory.create({ provider: 'openai' }), /Provider ID tidak valid/);
  assert.deepEqual(connector.CAPABILITIES.orcarouter, ['text']);
});

test('OrcaRouter sends the exact OpenAI-compatible request and normalizes output', async () => {
  let captured;
  const adapter = ProviderFactory.create({ provider: 'orcarouter', base_url: 'https://api.orcarouter.ai/', default_model: 'orcarouter/auto', api_key: 'saved-secret' }, async (url, options) => {
    captured = { url, options }; return new Response(JSON.stringify({ id: 'chat-1', choices: [{ message: { content: 'hasil' } }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }), { status: 200 });
  });
  const result = await adapter.execute({ prompt: 'hello' }); const body = JSON.parse(captured.options.body);
  assert.equal(captured.url, 'https://api.orcarouter.ai/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer saved-secret');
  assert.deepEqual(body, { model: 'orcarouter/auto', messages: [{ role: 'user', content: 'hello' }], stream: false });
  assert.equal(body.prompt, undefined); assert.equal(result.content, 'hasil');
  assert.deepEqual(result.usage, { promptTokens: 4, completionTokens: 2, totalTokens: 6 });
});

test('migration copies encrypted legacy key once, preserves legacy, and is idempotent', () => {
  const db = createDatabase(':memory:');
  db.prepare("INSERT INTO ai_provider_settings(provider,api_key_encrypted,base_url,default_model,timeout_ms,retry_count,enabled) VALUES('openai','encrypted-value','https://old.example', 'old-model',4567,3,1)").run();
  connector.seed(db); let target = db.prepare("SELECT * FROM ai_provider_settings WHERE provider='orcarouter'").get();
  assert.equal(target.api_key_encrypted, 'encrypted-value'); assert.equal(target.timeout_ms, 4567); assert.equal(target.retry_count, 3); assert.equal(target.enabled, 1);
  assert.equal(target.base_url, 'https://api.orcarouter.ai'); assert.equal(target.default_model, 'orcarouter/auto');
  assert.equal(db.prepare("SELECT api_key_encrypted FROM ai_provider_settings WHERE provider='openai'").get().api_key_encrypted, 'encrypted-value');
  db.prepare("UPDATE ai_provider_settings SET api_key_encrypted='existing-orca',base_url='https://custom.orca.test' WHERE provider='orcarouter'").run(); connector.seed(db); connector.seed(db);
  target = db.prepare("SELECT * FROM ai_provider_settings WHERE provider='orcarouter'").get(); assert.equal(target.api_key_encrypted, 'existing-orca'); assert.equal(target.base_url, 'https://custom.orca.test'); db.close();
});

test('registry hides legacy rows, failed authentication stays Offline, and text default is isolated', async () => {
  const db = createDatabase(':memory:'); connector.seed(db);
  db.prepare("INSERT OR IGNORE INTO ai_provider_settings(provider,base_url,default_model) VALUES('openai','https://api.orcarouter.ai','legacy')").run();
  connector.save(db, 'orcarouter', { apiKey: 'bad', enabled: true });
  connector.save(db, 'openai-images', { apiKey: 'image', enabled: true, isDefault: true, defaultCapability: 'image' });
  connector.save(db, 'orcarouter', { isDefault: true, defaultCapability: 'text' });
  const app = createApp({ db, aiTransport: async () => new Response('unauthorized', { status: 401 }) });
  const rows = (await request(app).get('/api/ai/providers').expect(200)).body;
  assert.ok(rows.some(row => row.provider === 'orcarouter')); assert.ok(!rows.some(row => row.provider === 'openai'));
  assert.deepEqual(rows.find(row => row.provider === 'orcarouter').defaultCapabilities, ['text']);
  assert.deepEqual(rows.find(row => row.provider === 'openai-images').defaultCapabilities, ['image']);
  const failure = await request(app).post('/api/ai/providers/orcarouter/test').expect(401); assert.equal(failure.body.error, 'API key OrcaRouter tidak valid');
  assert.equal(db.prepare("SELECT status FROM ai_provider_health WHERE provider='orcarouter'").get().status, 'Offline');
  assert.throws(() => connector.validateGeneration(db, { provider: 'orcarouter', mediaType: 'image', prompt: 'x' }), /tidak mendukung generate image/);
  db.close();
});
