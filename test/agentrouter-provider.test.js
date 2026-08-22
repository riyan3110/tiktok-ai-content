const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');

const jsonResponse = body => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

const responsesPayload = (text = 'OK') => ({
  id: 'resp-1',
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 }
});

test('AgentRouter is registered as text-only provider on agentrouter.org', () => {
  assert.ok(ProviderFactory.names().includes('agentrouter'));
  assert.deepEqual(ProviderFactory.defaults('agentrouter'), {
    baseUrl: 'https://agentrouter.org',
    model: 'gpt-5.5'
  });
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

test('AgentRouter legacy base URL is migrated automatically', () => {
  const db = createDatabase(':memory:');
  connector.seed(db);
  db.prepare("UPDATE ai_provider_settings SET base_url='https://co.agentrouter.org/v1' WHERE provider='agentrouter'").run();
  connector.seed(db);
  const row = db.prepare("SELECT base_url FROM ai_provider_settings WHERE provider='agentrouter'").get();
  assert.equal(row.base_url, 'https://agentrouter.org');
});

test('AgentRouter sends GPT-family models through unified Responses API', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'gpt-5.5'
  }, async (url, options = {}) => { calls.push({ url, options }); return jsonResponse(responsesPayload('GPT OK')); });

  const result = await provider.execute({ mediaType: 'text', model: 'gpt-5.5', prompt: 'Reply OK', parameters: { maxTokens: 256 } });
  assert.equal(calls[0].url, 'https://agentrouter.org/v1/responses');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer agent-secret');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'gpt-5.5');
  assert.equal(body.input, 'Reply OK');
  assert.equal(body.max_output_tokens, 256);
  assert.equal(result.content, 'GPT OK');
  assert.equal(result.usage.totalTokens, 4);
});

test('AgentRouter sends Claude models through unified Responses API', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'claude-opus-4-8'
  }, async (url, options = {}) => { calls.push({ url, options }); return jsonResponse(responsesPayload('CLAUDE OK')); });

  const result = await provider.execute({ mediaType: 'text', model: 'claude-opus-4-8', prompt: 'Reply OK', parameters: { maxTokens: 512 } });
  assert.equal(calls[0].url, 'https://agentrouter.org/v1/responses');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'claude-opus-4-8');
  assert.equal(body.input, 'Reply OK');
  assert.equal(body.max_output_tokens, 512);
  assert.equal(result.content, 'CLAUDE OK');
});

test('AgentRouter falls back to model-specific protocol when Responses endpoint is unavailable', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'claude-opus-4-8'
  }, async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/responses')) return new Response('not found', { status: 404 });
    return jsonResponse({ id: 'msg-1', content: [{ type: 'text', text: 'FALLBACK OK' }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 2 } });
  });
  const result = await provider.execute({ mediaType: 'text', model: 'claude-opus-4-8', prompt: 'Reply OK', parameters: {} });
  assert.deepEqual(calls.map(call => call.url), ['https://agentrouter.org/v1/responses', 'https://agentrouter.org/v1/messages']);
  assert.equal(result.content, 'FALLBACK OK');
});

test('AgentRouter Test Connection validates a real parsed one-token response', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'claude-opus-4-8', text_model: 'claude-opus-4-8'
  }, async (url, options = {}) => { calls.push({ url, options }); return jsonResponse(responsesPayload('O')); });
  const result = await provider.testConnection({});
  assert.equal(calls[0].url, 'https://agentrouter.org/v1/responses');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.max_output_tokens, 1);
  assert.equal(result.providerVersion, 'Unified Responses API');
  assert.ok(result.models.includes('claude-opus-4-8'));
  assert.ok(result.models.includes('gpt-5.5'));
});

test('AgentRouter refuses image/video generation', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter', base_url: 'https://agentrouter.org', api_key: 'agent-secret', default_model: 'gpt-5.5'
  }, async () => { throw new Error('transport should not run'); });
  await assert.rejects(() => provider.execute({ mediaType: 'image', prompt: 'image' }), /Text AI/);
  await assert.rejects(() => provider.execute({ mediaType: 'video', prompt: 'video' }), /Text AI/);
});
