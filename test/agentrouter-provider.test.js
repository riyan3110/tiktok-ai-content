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

test('AgentRouter is registered as text-only unified Responses API provider', () => {
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

test('AgentRouter legacy co.agentrouter.org base URL is migrated automatically', () => {
  const db = createDatabase(':memory:');
  connector.seed(db);
  db.prepare("UPDATE ai_provider_settings SET base_url='https://co.agentrouter.org/v1' WHERE provider='agentrouter'").run();
  connector.seed(db);
  const row = db.prepare("SELECT base_url FROM ai_provider_settings WHERE provider='agentrouter'").get();
  assert.equal(row.base_url, 'https://agentrouter.org');
});

test('AgentRouter model catalog uses agentrouter.org/v1/models', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://agentrouter.org',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, async url => {
    assert.equal(url, 'https://agentrouter.org/v1/models');
    return jsonResponse({ data: [{ id: 'custom-org-model' }] });
  });

  const health = await provider.testConnection({});
  assert.ok(health.models.includes('claude-opus-4-8'));
  assert.ok(health.models.includes('gpt-5.5'));
  assert.ok(health.models.includes('custom-org-model'));
  assert.equal(health.providerVersion, 'Unified Responses API');
});

test('AgentRouter sends all text models through /v1/responses', async () => {
  for (const model of ['gpt-5.5', 'claude-opus-4-8']) {
    const calls = [];
    const transport = async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({
        id: `resp-${model}`,
        status: 'completed',
        output_text: `OK ${model}`,
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }
      });
    };
    const provider = ProviderFactory.create({
      provider: 'agentrouter',
      base_url: 'https://agentrouter.org',
      api_key: 'agent-secret',
      default_model: 'gpt-5.5'
    }, transport);

    const result = await provider.execute({ mediaType: 'text', model, prompt: 'Reply OK', parameters: {} });
    assert.equal(calls[0].url, 'https://agentrouter.org/v1/responses');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer agent-secret');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.model, model);
    assert.equal(body.input, 'Reply OK');
    assert.equal(body.stream, false);
    assert.equal(result.content, `OK ${model}`);
    assert.equal(result.usage.totalTokens, 5);
  }
});

test('AgentRouter parses nested Responses API output content', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://agentrouter.org/v1/responses',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, async (url) => {
    assert.equal(url, 'https://agentrouter.org/v1/responses');
    return jsonResponse({
      id: 'resp-nested',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Nested OK' }] }],
      usage: { input_tokens: 1, output_tokens: 2 }
    });
  });
  const result = await provider.execute({ mediaType: 'text', prompt: 'hello' });
  assert.equal(result.content, 'Nested OK');
  assert.equal(result.usage.totalTokens, 3);
});

test('AgentRouter refuses image/video generation until generation endpoints are configured', async () => {
  const provider = ProviderFactory.create({
    provider: 'agentrouter',
    base_url: 'https://agentrouter.org',
    api_key: 'agent-secret',
    default_model: 'gpt-5.5'
  }, async () => { throw new Error('transport should not run'); });

  await assert.rejects(() => provider.execute({ mediaType: 'image', prompt: 'image' }), /Text AI/);
  await assert.rejects(() => provider.execute({ mediaType: 'video', prompt: 'video' }), /Text AI/);
});

test('AI Providers UI exposes AgentRouter unified Responses API and Claude choices', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'ai-providers.js'), 'utf8');
  assert.match(script, /AGENTROUTER_OFFICIAL_MODELS/);
  assert.match(script, /claude-opus-4-8/);
  assert.match(script, /Unified Responses API/);
  assert.match(script, /agentrouter\.org\/v1\/responses/);
  assert.match(script, /Refresh Models/);
  assert.match(script, /aiads\.agentrouter\.models/);
});
