const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');

const jsonResponse = body => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

test('AgentRouter is registered as text-only dual-protocol provider', () => {
  assert.ok(ProviderFactory.names().includes('agentrouter'));
  assert.deepEqual(ProviderFactory.defaults('agentrouter'), {
    baseUrl: 'https://co.agentrouter.org/v1',
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

test('AgentRouter model catalog includes official Claude fallbacks plus discovered models', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://co.agentrouter.org/v1',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, async url => {
    assert.equal(url, 'https://co.agentrouter.org/v1/models');
    return jsonResponse({ data: [{ id: 'custom-org-model' }] });
  });

  const health = await provider.testConnection({});
  assert.ok(health.models.includes('claude-opus-4-8'));
  assert.ok(health.models.includes('claude-opus-4-7'));
  assert.ok(health.models.includes('gpt-5.5'));
  assert.ok(health.models.includes('custom-org-model'));
  assert.equal(health.providerVersion, 'OpenAI + Anthropic Compatible');
});

test('AgentRouter sends OpenAI Chat Completions for non-Claude models', async () => {
  const calls = [];
  const transport = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({
      id: 'chat-1',
      choices: [{ message: { content: 'OK' } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
    });
  };
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://co.agentrouter.org/v1',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, transport);

  const result = await provider.execute({ mediaType: 'text', model: 'kimi-k2.6', prompt: 'Reply OK', parameters: {} });
  assert.equal(calls[0].url, 'https://co.agentrouter.org/v1/chat/completions');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer agent-secret');
  assert.equal(body.model, 'kimi-k2.6');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply OK' }]);
  assert.equal(result.content, 'OK');
  assert.equal(result.usage.totalTokens, 4);
});

test('AgentRouter sends Anthropic Messages for Claude models and strips /v1 from base URL', async () => {
  const calls = [];
  const transport = async (url, options = {}) => {
    calls.push({ url, options });
    return jsonResponse({
      id: 'msg-1',
      content: [{ type: 'text', text: 'CLAUDE OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 2 }
    });
  };
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://co.agentrouter.org/v1',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, transport);

  const result = await provider.execute({ mediaType: 'text', model: 'claude-opus-4-8', prompt: 'Reply OK', parameters: {} });
  assert.equal(calls[0].url, 'https://co.agentrouter.org/v1/messages');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer agent-secret');
  assert.equal(calls[0].options.headers['x-api-key'], 'agent-secret');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'claude-opus-4-8');
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply OK' }]);
  assert.equal(result.content, 'CLAUDE OK');
  assert.equal(result.usage.totalTokens, 7);
});

test('AgentRouter refuses image/video generation until co.agentrouter.org documents those endpoints', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://co.agentrouter.org/v1',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, async () => { throw new Error('transport should not run'); });

  await assert.rejects(() => provider.execute({ mediaType: 'image', prompt: 'image' }), /Text AI/);
  await assert.rejects(() => provider.execute({ mediaType: 'video', prompt: 'video' }), /Text AI/);
});

test('AI Providers UI always exposes official Claude choices for AgentRouter', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'ai-providers.js'), 'utf8');
  assert.match(script, /AGENTROUTER_OFFICIAL_MODELS/);
  assert.match(script, /claude-opus-4-8/);
  assert.match(script, /claude-opus-4-7/);
  assert.match(script, /Anthropic Messages otomatis/);
  assert.match(script, /Refresh Models/);
  assert.match(script, /aiads\.agentrouter\.models/);
});
