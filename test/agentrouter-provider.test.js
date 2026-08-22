const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');

const jsonResponse = body => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

test('AgentRouter is registered as text-only provider', () => {
  assert.ok(ProviderFactory.names().includes('agentrouter'));
  assert.deepEqual(connector.CAPABILITIES.agentrouter, ['text']);
});

test('AgentRouter API key stays encrypted in provider settings', () => {
  const db = createDatabase(':memory:');
  connector.seed(db);
  const saved = connector.save(db, 'agentrouter', { apiKey: 'agent-secret', enabled: true });
  const row = db.prepare('SELECT * FROM ai_provider_settings WHERE provider=?').get('agentrouter');
  assert.equal(saved.hasApiKey, true);
  assert.equal(saved.apiKey, '••••••••');
  assert.notEqual(row.api_key_encrypted, 'agent-secret');
  assert.equal(connector.configured(row).api_key, 'agent-secret');
});

test('AgentRouter normalizes website host to official API gateway', () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'x', default_model: 'gpt-5.5'
  });
  assert.equal(provider.rootBase(), 'https://co.agentrouter.org');
});

test('AgentRouter sends GPT-family models through OpenAI Chat Completions API gateway', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'gpt-5.5'
  }, async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ id: 'chat-1', choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } });
  });
  const result = await provider.execute({ mediaType: 'text', model: 'gpt-5.5', prompt: 'Reply OK', parameters: {} });
  assert.equal(calls[0].url, 'https://co.agentrouter.org/v1/chat/completions');
  assert.equal(result.content, 'OK');
});

test('AgentRouter sends Claude models through Anthropic Messages API gateway', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'claude-opus-4-8'
  }, async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ id: 'msg-1', content: [{ type: 'text', text: 'CLAUDE OK' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 2 } });
  });
  const result = await provider.execute({ mediaType: 'text', model: 'claude-opus-4-8', prompt: 'Reply OK', parameters: {} });
  assert.equal(calls[0].url, 'https://co.agentrouter.org/v1/messages');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer agent-secret');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
  assert.equal(result.content, 'CLAUDE OK');
});

test('AgentRouter Test Connection parses a real one-token model response', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'claude-opus-4-8', text_model: 'claude-opus-4-8'
  }, async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({ id: 'probe', content: [{ type: 'text', text: 'O' }], usage: { input_tokens: 2, output_tokens: 1 } });
  });
  const result = await provider.testConnection({});
  assert.equal(calls[0].url, 'https://co.agentrouter.org/v1/messages');
  assert.equal(JSON.parse(calls[0].options.body).max_tokens, 1);
  assert.equal(result.connected, true);
  assert.equal(result.providerVersion, 'Anthropic Messages');
});

test('AgentRouter Test Connection rejects HTML instead of reporting false Connected', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'claude-opus-4-8', text_model: 'claude-opus-4-8'
  }, async () => new Response('<!doctype html><html><body>website</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(() => provider.testConnection({}), /halaman HTML|bukan respons API JSON/);
});

test('AgentRouter refuses image/video generation', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'gpt-5.5'
  }, async () => { throw new Error('transport should not run'); });
  await assert.rejects(() => provider.execute({ mediaType: 'image', prompt: 'image' }), /Text AI/);
  await assert.rejects(() => provider.execute({ mediaType: 'video', prompt: 'video' }), /Text AI/);
});
