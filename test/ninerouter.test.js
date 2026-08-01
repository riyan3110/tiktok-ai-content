const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');
const NineRouterProvider = require('../src/providers/NineRouterProvider');
const { normalizeModels, normalizeCombos, discovery } = require('../src/services/nineRouterModels');

const directPayload = { data: [
  { id: 'deepseek/deepseek-v4-flash', capabilities: ['text'] },
  { id: 'openai/gpt-5', type: 'chat' }, { id: 'qwen/qwen-chat', service_type: 'text' },
  { id: 'openai/gpt-image-1', output_modalities: ['image'] },
  { id: 'google/veo-3', endpoint: '/video/generations' },
  { id: 'deepseek/image-by-wrong-name', capabilities: ['text'] }
] };
const comboPayload = { combos: [
  { id: 'My1', models: ['deepseek/deepseek-v4-flash'] },
  { id: 'My2', members: [{ model_id: 'openai/gpt-image-1' }] },
  { id: 'My3', routes: [{ model: 'google/veo-3' }] },
  { id: 'Multi', models: ['openai/gpt-image-1', 'google/veo-3'] }
] };
const catalog = discovery(normalizeCombos(comboPayload, directPayload), normalizeModels(directPayload));
const transport = async url => new Response(JSON.stringify(url.includes('/api/combos') ? comboPayload : directPayload), { headers: { 'content-type': 'application/json' } });

function setup() { const db=createDatabase(':memory:'); connector.save(db,'9router',{enabled:true}); return { db, app:createApp({db,aiTransport:transport}) }; }

test('9Router uses combo dashboard and direct model endpoints without /v1/v1', () => {
  assert.ok(ProviderFactory.names().includes('9router'));
  assert.equal(NineRouterProvider.joinGatewayUrl('http://host/v1','/api/combos'),'http://host/api/combos');
  assert.equal(NineRouterProvider.joinGatewayUrl('http://host/v1','/v1/models'),'http://host/v1/models');
  assert.doesNotMatch(NineRouterProvider.joinGatewayUrl('http://host/v1','/v1/models'),/v1\/v1/);
});

test('text catalog contains My1 plus DeepSeek, GPT, and Qwen direct models', () => {
  assert.deepEqual(catalog.text.combos, ['My1']);
  assert.deepEqual(catalog.text.directModels, ['deepseek/deepseek-v4-flash','deepseek/image-by-wrong-name','openai/gpt-5','qwen/qwen-chat']);
});

test('image and video catalogs contain only correctly capable combos and direct models', () => {
  assert.deepEqual(catalog.image, { combos: ['Multi','My2'], directModels: ['openai/gpt-image-1'] });
  assert.deepEqual(catalog.video, { combos: ['Multi','My3'], directModels: ['google/veo-3'] });
  assert.equal(catalog.video.directModels.includes('openai/gpt-5'), false);
  assert.equal(catalog.image.directModels.some(id=>id.startsWith('deepseek')), false);
  assert.equal(catalog.video.directModels.some(id=>id.startsWith('deepseek')), false);
});

test('official metadata wins over a misleading model name', () => assert.deepEqual(normalizeModels(directPayload).text.includes('deepseek/image-by-wrong-name'), true));

test('backend returns grouped normalized catalog and test connection updates the shared health status', async () => {
  const {db,app}=setup(); const response=(await request(app).get('/api/ai/providers/9router/models').expect(200)).body;
  assert.deepEqual(response.text,catalog.text); assert.equal(response.endpoints.combos,'/api/combos'); assert.equal(response.endpoints.directModels,'/v1/models');
  await request(app).post('/api/ai/providers/9router/test').expect(200);
  const list=(await request(app).get('/api/ai/providers').expect(200)).body; assert.equal(list.find(p=>p.provider==='9router').health.status,'Online');
  db.close();
});

test('choosing combo/direct keeps exact ID and stores type and capability in history', async () => {
  for (const [model,type] of [['My2','combo'],['openai/gpt-image-1','direct']]) { const {db,app}=setup(); await request(app).post('/api/content-studio/generate').send({provider:'9router',model,prompt:'draw',mediaType:'image'}).expect(202); const row=db.prepare('SELECT model,metadata FROM ai_generations').get(); assert.equal(row.model,model); assert.equal(JSON.parse(row.metadata).modelType,type); assert.equal(JSON.parse(row.metadata).capability,'image'); db.close(); }
});

test('UI has grouped selectors, no manual mapping/free-text, and keeps OrcaRouter selector', () => {
  const providers=fs.readFileSync('public/ai-providers.js','utf8'), studio=fs.readFileSync('public/content-studio.js','utf8'), html=fs.readFileSync('public/index.html','utf8');
  assert.match(providers,/COMBOS/); assert.match(providers,/DIRECT MODELS/); assert.doesNotMatch(providers,/Model Capability Mapping|Save Mapping|model-mappings|datalist/);
  assert.match(studio,/optionGroup\('COMBOS'/); assert.match(studio,/optionGroup\('DIRECT MODELS'/); assert.doesNotMatch(studio,/studio-nine-models|datalist|input\.value\.trim/);
  assert.match(html,/<select id="studio-model"/); assert.doesNotMatch(html,/<input id="studio-model"/); assert.match(html,/studio-orcarouter-model/);
});
