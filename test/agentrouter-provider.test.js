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

test('AgentRouter is registered as text-only OpenAI-compatible provider', () => {
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

test('AgentRouter lists models and sends OpenAI Chat Completions requests', async () => {
  const calls = [];
  const transport = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/models')) return jsonResponse({ data: [{ id: 'gpt-5.5' }, { id: 'kimi-k2.6' }, { id: 'glm-5.1' }] });
    if (url.endsWith('/chat/completions')) return jsonResponse({
      id: 'chat-1',
      choices: [{ message: { content: 'OK' } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
    });
    return new Response('not found', { status: 404 });
  };
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://co.agentrouter.org/v1',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, transport);

  const health = await provider.testConnection({});
  assert.deepEqual(health.models, ['gpt-5.5', 'kimi-k2.6', 'glm-5.1']);

  const result = await provider.execute({ mediaType: 'text', model: 'kimi-k2.6', prompt: 'Reply OK', parameters: {} });
  const chat = calls.find(call => call.url.endsWith('/chat/completions'));
  const body = JSON.parse(chat.options.body);
  assert.equal(chat.options.headers.Authorization, 'Bearer agent-secret');
  assert.equal(body.model, 'kimi-k2.6');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply OK' }]);
  assert.equal(result.content, 'OK');
  assert.equal(result.usage.totalTokens, 4);
});

test('AI Providers UI exposes AgentRouter model refresh and picker', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'ai-providers.js'), 'utf8');
  assert.match(script, /agentrouter/);
  assert.match(script, /Refresh Models/);
  assert.match(script, /aiads\.agentrouter\.models/);
  assert.match(script, /Default Text Model/);
});
