const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');

const jsonResponse = body => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

test('BluesMinds replacement keeps legacy agentrouter provider id as text-only', () => {
  assert.ok(ProviderFactory.names().includes('agentrouter'));
  assert.deepEqual(connector.CAPABILITIES.agentrouter, ['text']);
  assert.equal(ProviderFactory.defaults('agentrouter').baseUrl, 'https://api.bluesminds.com/v1');
});

test('BluesMinds API key stays encrypted in provider settings', () => {
  const db = createDatabase(':memory:');
  connector.seed(db);
  const saved = connector.save(db, 'agentrouter', { apiKey: 'blues-secret', enabled: true });
  const row = db.prepare('SELECT * FROM ai_provider_settings WHERE provider=?').get('agentrouter');
  assert.equal(saved.name, 'BluesMinds');
  assert.equal(saved.hasApiKey, true);
  assert.equal(saved.apiKey, '••••••••');
  assert.notEqual(row.api_key_encrypted, 'blues-secret');
  assert.equal(connector.configured(row).api_key, 'blues-secret');
});

test('legacy AgentRouter base URL migrates to BluesMinds', () => {
  const db = createDatabase(':memory:');
  connector.seed(db);
  db.prepare("UPDATE ai_provider_settings SET base_url='https://agentrouter.org',default_model='gpt-5.5',text_model='gpt-5.5' WHERE provider='agentrouter'").run();
  connector.seed(db);
  const row = db.prepare("SELECT * FROM ai_provider_settings WHERE provider='agentrouter'").get();
  assert.equal(row.base_url, 'https://api.bluesminds.com/v1');
  assert.equal(row.text_model, 'deepseek-ai/deepseek-v4-flash');
});

test('BluesMinds sends text through OpenAI Chat Completions', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://api.bluesminds.com/v1', api_key: 'blues-secret', default_model: 'deepseek-ai/deepseek-v4-flash'
  }, async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ id: 'chat-1', choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } });
  });
  const result = await provider.execute({ mediaType: 'text', model: 'deepseek-ai/deepseek-v4-flash', prompt: 'Reply OK', parameters: {} });
  assert.equal(calls[0].url, 'https://api.bluesminds.com/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer blues-secret');
  assert.equal(result.content, 'OK');
});

test('BluesMinds Test Connection parses a real one-token model response', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://api.bluesminds.com/v1', api_key: 'blues-secret', default_model: 'deepseek-ai/deepseek-v4-flash', text_model: 'deepseek-ai/deepseek-v4-flash'
  }, async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'deepseek-ai/deepseek-v4-flash' }, { id: 'z-ai/glm-5.1' }] });
    return jsonResponse({ id: 'probe', choices: [{ message: { content: 'O' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
  });
  const result = await provider.testConnection({});
  assert.equal(calls[0].url, 'https://api.bluesminds.com/v1/chat/completions');
  assert.equal(JSON.parse(calls[0].options.body).max_tokens, 1);
  assert.equal(result.connected, true);
  assert.equal(result.providerVersion, 'OpenAI Chat Completions');
  assert.ok(result.models.includes('z-ai/glm-5.1'));
});

test('BluesMinds Test Connection rejects HTML instead of reporting false Connected', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://api.bluesminds.com/v1', api_key: 'blues-secret', default_model: 'deepseek-ai/deepseek-v4-flash', text_model: 'deepseek-ai/deepseek-v4-flash'
  }, async () => new Response('<!doctype html><html><body>website</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(() => provider.testConnection({}), /halaman HTML|bukan respons API JSON/);
});

test('BluesMinds replacement remains text-only in AI Ads Lab', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://api.bluesminds.com/v1', api_key: 'blues-secret', default_model: 'deepseek-ai/deepseek-v4-flash'
  }, async () => { throw new Error('transport should not run'); });
  await assert.rejects(() => provider.execute({ mediaType: 'image', prompt: 'image' }), /Text AI/);
  await assert.rejects(() => provider.execute({ mediaType: 'video', prompt: 'video' }), /Text AI/);
});
