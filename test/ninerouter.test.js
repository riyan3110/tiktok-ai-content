const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');
const NineRouterProvider = require('../src/providers/NineRouterProvider');
const { normalizeModels } = require('../src/services/nineRouterModels');

const catalog = { data: [
  { id: 'My2', capabilities: ['chat'] },
  { id: 'picture-pro', output_modalities: ['image'] },
  { id: 'movie-pro', service_kind: 'video' },
  { id: 'mystery' }
] };

test('9Router is one canonical multi-capability provider with safe URLs', () => {
  assert.ok(ProviderFactory.names().includes('9router'));
  assert.equal(ProviderFactory.names().filter(id => id === '9router').length, 1);
  assert.deepEqual(connector.CAPABILITIES['9router'], ['text', 'image', 'video']);
  assert.equal(NineRouterProvider.joinGatewayUrl('http://43.159.50.231:20130/v1', '/v1/models'), 'http://43.159.50.231:20130/v1/models');
  assert.doesNotMatch(NineRouterProvider.joinGatewayUrl('http://host/v1/', '/v1/chat/completions'), /v1\/v1/);
});

test('9Router catalog uses metadata, preserves unknown, and never forces My2', () => {
  assert.deepEqual(normalizeModels(catalog), { text: ['My2'], image: ['picture-pro'], video: ['movie-pro'], unknown: ['mystery'] });
  assert.deepEqual(normalizeModels({ data: [{ id: 'My2' }] }), { text: [], image: [], video: [], unknown: ['My2'] });
});

test('9Router discovery is backend-only and gateway key stays secret', async () => {
  const db = createDatabase(':memory:'); connector.save(db, '9router', { apiKey: 'gateway-secret', enabled: true }); let call;
  const app = createApp({ db, aiTransport: async (url, options) => { call = { url, options }; return new Response(JSON.stringify(catalog)); } });
  const body = (await request(app).get('/api/ai/providers/9router/models').expect(200)).body;
  assert.equal(call.url, 'http://43.159.50.231:20130/v1/models'); assert.equal(call.options.headers.Authorization, 'Bearer gateway-secret'); assert.deepEqual(body.image, ['picture-pro']);
  const providers = (await request(app).get('/api/ai/providers').expect(200)).body; const nine = providers.find(item => item.provider === '9router'); assert.equal(nine.apiKey, undefined); assert.equal(JSON.stringify(nine).includes('gateway-secret'), false); db.close();
});

test('9Router uses selected text/image model and no invented video route', async () => {
  const calls=[]; const adapter=ProviderFactory.create({ provider:'9router',base_url:'http://host/v1',api_key:'' },async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify(url.includes('images')?{data:[{b64_json:'AA=='}]}:{choices:[{message:{content:'ok'}}]}));});
  await adapter.execute({mediaType:'text',model:'My2',prompt:'hi'}); await adapter.execute({mediaType:'image',model:'picture-pro',prompt:'draw'});
  assert.equal(calls[0].url,'http://host/v1/chat/completions'); assert.equal(calls[0].body.model,'My2'); assert.equal(calls[1].url,'http://host/v1/images/generations'); assert.equal(calls[1].body.model,'picture-pro'); await assert.rejects(adapter.execute({mediaType:'video',model:'movie-pro',prompt:'go'}),/tidak mengekspos endpoint video/);
});
