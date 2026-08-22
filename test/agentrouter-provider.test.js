const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');

const jsonResponse = body => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' }
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

test('AgentRouter sends GPT-family models through OpenAI Chat Completions', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://agentrouter.org',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({
      id: 'chat-1',
      choices: [{ message: { content: 'OK' } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
    });
  });

  const result = await provider.execute({ mediaType: 'text', model: 'gpt-5.5', prompt: 'Reply OK', parameters: {} });
  assert.equal(calls[0].url, 'https://agentrouter.org/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer agent-secret');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'gpt-5.5');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply OK' }]);
  assert.equal(result.content, 'OK');
  assert.equal(result.usage.totalTokens, 4);
});

test('AgentRouter sends Claude models through Anthropic Messages', async () => {
  const calls = [];
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://agentrouter.org',
    api_key: 'agent-secret',
    default_model: 'claude-opus-4-8'
  }, async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({
      id: 'msg-1',
      content: [{ type: 'text', text: 'CLAUDE OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 }
    });
  });

  const result = await provider.execute({ mediaType: 'text', model: 'claude-opus-4-8', prompt: 'Reply OK', parameters: {} });
  assert.equal(calls[0].url, 'https://agentrouter.org/v1/messages');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer agent-secret');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'claude-opus-4-8');
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply OK' }]);
  assert.equal(result.content, 'CLAUDE OK');
  assert.equal(result.usage.totalTokens, 7);
});

test('AgentRouter Test Connection probes selected protocol with only one output token', async () => {
  for (const [model, expectedPath] of [
    ['gpt-5.5', '/v1/chat/completions'],
    ['claude-opus-4-8', '/v1/messages']
  ]) {
    const calls = [];
    const provider = ProviderFactory.create({
      provider: 'agentrouter',
      base_url: 'https://agentrouter.org',
      api_key: 'agent-secret',
      default_model: model,
      text_model: model
    }, async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse(model.startsWith('claude-')
        ? { id: 'probe-claude', content: [{ type: 'text', text: 'O' }], usage: { input_tokens: 2, output_tokens: 1 } }
        : { id: 'probe-openai', choices: [{ message: { content: 'O' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
    });
    const result = await provider.testConnection({});
    assert.equal(calls[0].url, `https://agentrouter.org${expectedPath}`);
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, model);
    assert.equal(body.max_tokens, 1);
    assert.ok(result.models.includes('claude-opus-4-8'));
    assert.ok(result.models.includes('gpt-5.5'));
  }
});

test('AgentRouter refuses image/video generation', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://agentrouter.org',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, async () => { throw new Error('transport should not run'); });

  await assert.rejects(() => provider.execute({ mediaType: 'image', prompt: 'image' }), /Text AI/);
  await assert.rejects(() => provider.execute({ mediaType: 'video', prompt: 'video' }), /Text AI/);
});
