const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');
const NineRouterProvider = require('../src/providers/NineRouterProvider');
const { normalizeCatalog, discovery, CATALOG_PATHS } = require('../src/services/nineRouterModels');

const payloads = {
  '/v1/models': { object: 'list', data: [{ id: 'TextCombo', owned_by: 'combo' }, { id: 'openai/gpt-5', owned_by: 'openai' }] },
  '/v1/models/image': { object: 'list', data: [{ id: 'ImageCombo', owned_by: 'combo' }, { id: 'openai/gpt-image-1', owned_by: 'openai' }] },
  '/v1/models/video': { object: 'list', data: [{ id: 'VideoCombo', owned_by: 'combo' }, { id: 'google/veo-3', owned_by: 'google' }] }
};

function setup() {
  const calls = [];
  const transport = async (url, options = {}) => {
    calls.push({ url, headers: options.headers });
    const path = new URL(url).pathname;
    return new Response(JSON.stringify(payloads[path]), { headers: { 'content-type': 'application/json' } });
  };
  const db = createDatabase(':memory:');
  connector.save(db, '9router', { enabled: true, apiKey: 'saved-gateway-key' });
  return { db, calls, app: createApp({ db, aiTransport: transport }) };
}

test('9Router catalog paths use the gateway URL without creating /v1/v1', () => {
  assert.ok(ProviderFactory.names().includes('9router'));
  assert.deepEqual(CATALOG_PATHS, { text: '/v1/models', image: '/v1/models/image', video: '/v1/models/video' });
  for (const path of Object.values(CATALOG_PATHS)) {
    const url = NineRouterProvider.joinGatewayUrl('http://host/v1', path);
    assert.doesNotMatch(url, /v1\/v1/);
    assert.equal(new URL(url).pathname, path);
  }
  assert.equal(
    NineRouterProvider.joinGatewayUrl(NineRouterProvider.DEFAULT_BASE_URL, '/v1/images/generations'),
    'http://43.159.50.231:20130/v1/images/generations'
  );
});

test('each OpenAI catalog groups owned_by combo separately from direct models', () => {
  assert.deepEqual(normalizeCatalog(payloads['/v1/models']), { combos: ['TextCombo'], directModels: ['openai/gpt-5'] });
  assert.deepEqual(normalizeCatalog(payloads['/v1/models/image']), { combos: ['ImageCombo'], directModels: ['openai/gpt-image-1'] });
  assert.deepEqual(normalizeCatalog(payloads['/v1/models/video']), { combos: ['VideoCombo'], directModels: ['google/veo-3'] });
  assert.throws(() => normalizeCatalog({ object: 'list', combos: [{ id: 'never-read' }] }), /tidak valid/);
});

test('all three catalogs receive the same saved Bearer key and populate image and video automatically', async () => {
  const { db, calls, app } = setup();
  const response = (await request(app).get('/api/ai/providers/9router/models').expect(200)).body;
  assert.deepEqual(calls.map(call => new URL(call.url).pathname).sort(), Object.values(CATALOG_PATHS).sort());
  assert.deepEqual(new Set(calls.map(call => call.headers.Authorization)), new Set(['Bearer saved-gateway-key']));
  assert.deepEqual(response.image, { combos: ['ImageCombo'], directModels: ['openai/gpt-image-1'] });
  assert.deepEqual(response.video, { combos: ['VideoCombo'], directModels: ['google/veo-3'] });
  assert.deepEqual(response.counts, { text: 2, image: 2, video: 2 });
  db.close();
});

test('Test Connection counts models from all three catalogs', async () => {
  const { db, app } = setup();
  const response = await request(app).post('/api/ai/providers/9router/test').expect(200);
  assert.deepEqual(response.body.counts, { text: 2, image: 2, video: 2 });
  assert.deepEqual(response.body.capabilities, ['text', 'image', 'video']);
  db.close();
});

test('generation uses the gateway client and saved Bearer key, never a saved dashboard URL', async () => {
  const calls = [];
  const transport = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/result.png' }] }), { headers: { 'content-type': 'application/json' } });
  };
  const db = createDatabase(':memory:');
  connector.save(db, '9router', { enabled: true, apiKey: 'saved-gateway-key', baseUrl: 'http://43.159.50.231:20128' });
  await connector.execute(db, { provider: '9router', model: 'ImageCombo', prompt: 'draw', mediaType: 'image' }, transport);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://43.159.50.231:20130/v1/images/generations');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer saved-gateway-key');
  db.close();
});

test('missing 9Router key is rejected before generation history and AbortError is not retried', async () => {
  const db = createDatabase(':memory:');
  connector.save(db, '9router', { enabled: true, retry: 3 });
  await assert.rejects(
    connector.execute(db, { provider: '9router', model: 'ImageCombo', prompt: 'draw', mediaType: 'image' }, async () => new Response('{}')),
    /API key/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_generations').get().count, 0);

  connector.save(db, '9router', { apiKey: 'saved-gateway-key' });
  let calls = 0;
  await assert.rejects(
    connector.execute(db, { provider: '9router', model: 'ImageCombo', prompt: 'draw', mediaType: 'image' }, async () => {
      calls += 1;
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }),
    error => error.type === 'Timeout'
  );
  assert.equal(calls, 1);
  db.close();
});

test('choosing discovered combo/direct keeps exact ID and stores type and capability in history', async () => {
  for (const [model, type] of [['ImageCombo', 'combo'], ['openai/gpt-image-1', 'direct']]) {
    const { db, app } = setup();
    await request(app).post('/api/content-studio/generate').send({ provider: '9router', model, prompt: 'draw', mediaType: 'image' }).expect(202);
    const row = db.prepare('SELECT model,metadata FROM ai_generations').get();
    assert.equal(row.model, model);
    assert.equal(JSON.parse(row.metadata).modelType, type);
    assert.equal(JSON.parse(row.metadata).capability, 'image');
    db.close();
  }
});

test('UI keeps grouped automatic selectors, no free-text input, and OrcaRouter remains present', () => {
  const providers = fs.readFileSync('public/ai-providers.js', 'utf8');
  const studio = fs.readFileSync('public/content-studio.js', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.match(providers, /COMBOS/);
  assert.match(providers, /DIRECT MODELS/);
  assert.match(studio, /optionGroup\('COMBOS'/);
  assert.match(studio, /optionGroup\('DIRECT MODELS'/);
  assert.doesNotMatch(studio, /studio-nine-models|datalist|input\.value\.trim/);
  assert.match(html, /<select id="studio-model"/);
  assert.doesNotMatch(html, /<input id="studio-model"/);
  assert.match(html, /studio-orcarouter-model/);
});

test('discovery does not infer capabilities from model names', () => {
  const catalogs = discovery({
    text: { object: 'list', data: [{ id: 'looks-like-an-image', owned_by: 'vendor' }] },
    image: { object: 'list', data: [] },
    video: { object: 'list', data: [] }
  });
  assert.deepEqual(catalogs.text.directModels, ['looks-like-an-image']);
  assert.deepEqual(catalogs.image.directModels, []);
});
