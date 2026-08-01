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
  assert.deepEqual(connector.CAPABILITIES.orcarouter, ['text', 'image', 'video']);
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
  assert.doesNotThrow(() => connector.validateGeneration(db, { provider: 'orcarouter', mediaType: 'image', prompt: 'x' }));
  db.close();
});

test('OrcaRouter uses capability-specific image endpoint, model, and response formats', async () => {
  const calls = [];
  const adapter = ProviderFactory.create({ provider: 'orcarouter', base_url: 'https://api.orcarouter.ai', default_model: 'orcarouter/auto', image_model: 'openai/gpt-image-1', video_model: 'kling/kling-v2-6', api_key: 'one-key' }, async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=', mime_type: 'image/png' }] }), { status: 200 });
  });
  const result = await adapter.execute({ mediaType: 'image', prompt: 'poster', parameters: { resolution: '1024x1024' } });
  assert.equal(calls[0].url, 'https://api.orcarouter.ai/v1/images/generations');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer one-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'openai/gpt-image-1', prompt: 'poster', size: '1024x1024' });
  assert.equal(result.media[0].b64_json, 'aGVsbG8=');
});

test('OrcaRouter polls video tasks through SUCCESS and records result_url', async () => {
  const calls = []; let polls = 0;
  const adapter = ProviderFactory.create({ provider: 'orcarouter', base_url: 'https://api.orcarouter.ai', default_model: 'orcarouter/auto', video_model: 'kling/kling-v2-6', video_poll_interval_ms: 1, api_key: 'one-key' }, async (url, options) => {
    calls.push({ url, options });
    if (!options?.method) { polls += 1; return new Response(JSON.stringify({ data: polls === 1 ? { status: 'IN_PROGRESS' } : { status: 'SUCCESS', result_url: 'https://cdn.example/video.mp4' } }), { status: 200 }); }
    return new Response(JSON.stringify({ task_id: 'task-7', status: 'SUBMITTED' }), { status: 200 });
  });
  const result = await adapter.execute({ mediaType: 'video', prompt: 'vertical ad', parameters: {} });
  assert.equal(calls[0].url, 'https://api.orcarouter.ai/v1/video/generations');
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'kling/kling-v2-6', prompt: 'vertical ad', metadata: { mode: 'std', aspect_ratio: '9:16', duration: '5' } });
  assert.equal(calls.at(-1).url, 'https://api.orcarouter.ai/v1/video/generations/task-7');
  assert.equal(result.media[0].url, 'https://cdn.example/video.mp4');
});

test('OrcaRouter video FAILURE is terminal and preserves fail_reason', async () => {
  const adapter = ProviderFactory.create({ provider: 'orcarouter', base_url: 'https://api.orcarouter.ai', video_model: 'kling/kling-v2-6', video_poll_interval_ms: 1, api_key: 'one-key' }, async (_url, options) => new Response(JSON.stringify(options?.method ? { task_id: 'bad-task' } : { data: { status: 'FAILURE', fail_reason: 'policy rejected' } }), { status: 200 }));
  await assert.rejects(adapter.execute({ mediaType: 'video', prompt: 'bad', parameters: {} }), /policy rejected/);
});
