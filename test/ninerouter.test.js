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
  assert.deepEqual(normalizeModels({ data: [{ id: 'mapped-picture', type: 'unknown' }] }, { 'mapped-picture': ['image'] }).image, ['mapped-picture']);
});

test('9Router discovered capabilities refresh and gate image defaults without changing OrcaRouter', async () => {
  const db = createDatabase(':memory:'); connector.save(db, '9router', { enabled: true, imageModel: '' });
  let current = { data: [{ id: 'chat', capabilities: ['text'] }, { id: 'clip', capabilities: ['video'] }] };
  const app = createApp({ db, aiTransport: async () => new Response(JSON.stringify(current)) });
  const absent = (await request(app).get('/api/ai/providers/9router/models?refresh=true').expect(200)).body;
  assert.deepEqual(absent.capabilities, ['text', 'video']); assert.equal(absent.image.length, 0); assert.match(absent.diagnostics.image.reasons.join(' '), /tidak mengembalikan model image/);
  await request(app).put('/api/ai/providers/9router').send({ isDefault: true, defaultCapability: 'image' }).expect(200);
  assert.equal(db.prepare("SELECT provider FROM ai_provider_defaults WHERE capability='image'").get().provider, '9router');

  current = { data: [{ id: 'chat', capabilities: ['text'] }, { id: 'image-v2', output_modalities: ['image'] }, { id: 'clip', capabilities: ['video'] }] };
  const refreshed = (await request(app).get('/api/ai/providers/9router/models?refresh=true').expect(200)).body;
  assert.deepEqual(refreshed.capabilities, ['text', 'image', 'video']); assert.deepEqual(refreshed.image, ['image-v2']);
  await request(app).post('/api/ai/providers/9router/test').expect(200);
  await request(app).put('/api/ai/providers/9router').send({ isDefault: true, defaultCapability: 'image' }).expect(200);
  assert.equal(db.prepare("SELECT image_model FROM ai_provider_settings WHERE provider='9router'").get().image_model, 'image-v2');
  assert.equal(db.prepare("SELECT provider FROM ai_provider_defaults WHERE capability='image'").get().provider, '9router');
  const providers = (await request(app).get('/api/ai/providers').expect(200)).body;
  assert.deepEqual(connector.CAPABILITIES['9router'], ['text', 'image', 'video']);
  assert.deepEqual(providers.find(item => item.provider === 'orcarouter').capabilities, ['text', 'image', 'video']);
  assert.equal(providers.filter(item => item.provider === '9router').length, 1);
  db.close();
});

test('Default provider dropdown keeps enabled 9Router additive without hiding OrcaRouter', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/ai-providers.js'), 'utf8');
  assert.match(source, /p\.enabled&&p\.capabilities\.includes\(capability\)/);
  assert.doesNotMatch(source, /p\.health\.status==='Online'&&nineModels/);
  assert.doesNotMatch(source, /imageModel.*includes\(capability\)/);
  assert.match(source, /Detected capabilities/);
  assert.match(source, /models\)<\/span>/);
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


test('unknown mappings persist, update discovery immediately, and official metadata wins', async () => {
  const db = createDatabase(':memory:'); connector.save(db, '9router', { enabled: true, textModel: 'deepseek-r1', imageModel: 'manual-image', videoModel: 'movie' });
  const models = { data: [
    { id: 'deepseek-r1', capabilities: ['chat'] },
    { id: 'deepseek-v3', type: 'text' },
    { id: 'qwen-chat' },
    { id: 'movie', output_modalities: ['video'] },
    { id: 'official-text', capabilities: ['text'] }
  ] };
  const transport = async () => new Response(JSON.stringify(models));
  let app = createApp({ db, aiTransport: transport });
  const before = (await request(app).get('/api/ai/providers/9router/models').expect(200)).body;
  assert.deepEqual(before.text, ['deepseek-r1', 'deepseek-v3', 'official-text']);
  assert.deepEqual(before.video, ['movie']);
  assert.deepEqual(before.unknown, ['qwen-chat']);
  const after = (await request(app).put('/api/ai/providers/9router/model-mappings').send({ manualMappings: { 'qwen-chat': 'image', 'official-text': 'video' } }).expect(200)).body;
  assert.deepEqual(after.image, ['qwen-chat']);
  assert.equal(after.video.includes('official-text'), false);
  assert.deepEqual(after.manualMappings, { 'official-text': 'video', 'qwen-chat': 'image' });
  app = createApp({ db, aiTransport: transport });
  const restarted = (await request(app).get('/api/ai/providers/9router/models').expect(200)).body;
  assert.deepEqual(restarted.image, ['qwen-chat']);
  assert.equal(restarted.text.includes('official-text'), true);
  const row = db.prepare("SELECT text_model,image_model,video_model FROM ai_provider_settings WHERE provider='9router'").get();
  assert.deepEqual(row, { text_model: 'deepseek-r1', image_model: 'manual-image', video_model: 'movie' });
  db.close();
});

test('9Router UI provides separate searchable models and mapping without leaking keys', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const providersUi = fs.readFileSync(path.join(__dirname, '../public/ai-providers.js'), 'utf8');
  const studioUi = fs.readFileSync(path.join(__dirname, '../public/content-studio.js'), 'utf8');
  assert.match(providersUi, /Default Text Model/); assert.match(providersUi, /Default Image Model/); assert.match(providersUi, /Default Video Model/);
  assert.match(providersUi, /Model Capability Mapping/); assert.match(providersUi, /Save Mapping/); assert.match(providersUi, /datalist/);
  assert.match(providersUi, /Saved keys are never returned/);
  assert.match(studioUi, /studio-nine-models/); assert.match(studioUi, /NINE_MODEL_KEYS/);
  assert.match(studioUi, /provider.*==='orcarouter'.*studio-orcarouter-model/);
});
