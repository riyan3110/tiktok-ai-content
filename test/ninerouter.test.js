const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');
const NineRouterProvider = require('../src/providers/NineRouterProvider');
const { discovery } = require('../src/services/nineRouterModels');

const fixtures = {
  text: { object: 'list', data: [
    { id: 'My1', object: 'model', owned_by: 'combo' },
    { id: 'My2', object: 'model', owned_by: 'combo' },
    { id: 'My3', object: 'model', owned_by: 'combo' },
    { id: 'deepseek/deepseek-v4-flash', object: 'model', owned_by: 'deepseek' }
  ] },
  image: { object: 'list', data: [
    { id: 'ImageCombo', object: 'model', owned_by: 'combo' },
    { id: 'openai/gpt-image-1', object: 'model', owned_by: 'openai' }
  ] },
  video: { object: 'list', data: [
    { id: 'VideoCombo', object: 'model', owned_by: 'combo' },
    { id: 'google/veo-3', object: 'model', owned_by: 'google' }
  ] }
};
const catalog = discovery(fixtures);
const calls = [];
const transport = async (url, options = {}) => {
  calls.push({ url, headers: options.headers });
  const fixture = url.endsWith('/models/image') ? fixtures.image : url.endsWith('/models/video') ? fixtures.video : fixtures.text;
  return new Response(JSON.stringify(fixture), { headers: { 'content-type': 'application/json' } });
};

function setup() { const db=createDatabase(':memory:'); connector.save(db,'9router',{enabled:true,apiKey:'saved-gateway-key'}); return { db, app:createApp({db,aiTransport:transport}) }; }

test('9Router uses the three gateway catalog endpoints without /v1/v1', () => {
  assert.ok(ProviderFactory.names().includes('9router'));
  assert.equal(NineRouterProvider.joinGatewayUrl('http://host/v1','/v1/models'),'http://host/v1/models');
  assert.equal(NineRouterProvider.joinGatewayUrl('http://host/v1','/v1/models/image'),'http://host/v1/models/image');
  assert.equal(NineRouterProvider.joinGatewayUrl('http://host/v1','/v1/models/video'),'http://host/v1/models/video');
});

test('owned_by combo classifies text combos without combo member data', () => {
  assert.deepEqual(catalog.text.combos, ['My1','My2','My3']);
  assert.deepEqual(catalog.text.directModels, ['deepseek/deepseek-v4-flash']);
});

test('image and video responses populate their own combo and direct model groups', () => {
  assert.deepEqual(catalog.image, { combos: ['ImageCombo'], directModels: ['openai/gpt-image-1'] });
  assert.deepEqual(catalog.video, { combos: ['VideoCombo'], directModels: ['google/veo-3'] });
});

test('backend requests every catalog with the saved Bearer gateway key and Test Connection succeeds', async () => {
  calls.length = 0;
  const {db,app}=setup();
  const response=(await request(app).get('/api/ai/providers/9router/models').expect(200)).body;
  assert.deepEqual(response.text,catalog.text);
  assert.deepEqual(response.endpoints,{text:'/v1/models',image:'/v1/models/image',video:'/v1/models/video'});
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/v1/models','/v1/models/image','/v1/models/video']);
  assert.ok(calls.every(call => call.headers.Authorization === 'Bearer saved-gateway-key'));
  await request(app).post('/api/ai/providers/9router/test').expect(200);
  const list=(await request(app).get('/api/ai/providers').expect(200)).body; assert.equal(list.find(p=>p.provider==='9router').health.status,'Online');
  db.close();
});

test('choosing combo/direct keeps exact ID and stores type and capability in history', async () => {
  for (const [model,type] of [['ImageCombo','combo'],['openai/gpt-image-1','direct']]) { const {db,app}=setup(); await request(app).post('/api/content-studio/generate').send({provider:'9router',model,prompt:'draw',mediaType:'image'}).expect(202); const row=db.prepare('SELECT model,metadata FROM ai_generations').get(); assert.equal(row.model,model); assert.equal(JSON.parse(row.metadata).modelType,type); assert.equal(JSON.parse(row.metadata).capability,'image'); db.close(); }
});

test('UI has grouped selectors, no manual mapping/free-text, and keeps OrcaRouter selector', () => {
  const providers=fs.readFileSync('public/ai-providers.js','utf8'), studio=fs.readFileSync('public/content-studio.js','utf8'), html=fs.readFileSync('public/index.html','utf8');
  assert.match(providers,/COMBOS/); assert.match(providers,/DIRECT MODELS/); assert.doesNotMatch(providers,/Model Capability Mapping|Save Mapping|model-mappings|datalist/);
  assert.match(studio,/optionGroup\('COMBOS'/); assert.match(studio,/optionGroup\('DIRECT MODELS'/); assert.doesNotMatch(studio,/studio-nine-models|datalist|input\.value\.trim/);
  assert.match(html,/<select id="studio-model"/); assert.doesNotMatch(html,/<input id="studio-model"/); assert.match(html,/studio-orcarouter-model/);
});
