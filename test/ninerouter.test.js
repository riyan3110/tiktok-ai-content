const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');
const NineRouterProvider = require('../src/providers/NineRouterProvider');
const { catalogFromPayload, CATALOG_PATHS } = require('../src/services/nineRouterModels');
const { NineRouterClient, API_BASE_URL } = require('../src/services/nineRouterClient');

const payloads = {
  [`${API_BASE_URL}/models`]: { object: 'list', data: [{ id: 'My1', owned_by: 'combo' }, { id: 'deepseek/deepseek-v4-flash', owned_by: 'deepseek' }, { id: 'openai/gpt-5', owned_by: 'openai' }] },
  [`${API_BASE_URL}/models/image`]: { object: 'list', data: [{ id: 'My2', owned_by: 'combo' }, { id: 'openai/gpt-image-1', owned_by: 'openai' }] },
  [`${API_BASE_URL}/models/video`]: { object: 'list', data: [{ id: 'My3', owned_by: 'combo' }, { id: 'google/veo-3', owned_by: 'google' }] }
};
const catalog = {
  text: catalogFromPayload(payloads[`${API_BASE_URL}/models`]),
  image: catalogFromPayload(payloads[`${API_BASE_URL}/models/image`]),
  video: catalogFromPayload(payloads[`${API_BASE_URL}/models/video`])
};
const calls = [];
const transport = async (url, options={}) => { calls.push({url, options}); const payload = payloads[url] || { id: 'generation-1', choices: [{ message: { content: 'ok' } }] }; return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }); };

function setup() { calls.length=0; const db=createDatabase(':memory:'); connector.save(db,'9router',{enabled:true,apiKey:'gateway-secret'}); return { db, app:createApp({db,aiTransport:transport}) }; }

test('9Router always uses the exact API models URL, never dashboard port or duplicated v1', () => {
  assert.ok(ProviderFactory.names().includes('9router'));
  assert.equal(NineRouterProvider.joinGatewayUrl('http://host:20128/v1','/v1/models'),`${API_BASE_URL}/models`);
  assert.doesNotMatch(NineRouterProvider.joinGatewayUrl('', '/v1/models'),/20128|v1\/v1/);
});

test('each endpoint classifies only owned_by combo as a combo', () => {
  assert.deepEqual(catalog.text.combos, ['My1']);
  assert.deepEqual(catalog.text.directModels, ['deepseek/deepseek-v4-flash','openai/gpt-5']);
  assert.deepEqual(catalog.image, { combos: ['My2'], directModels: ['openai/gpt-image-1'] });
  assert.deepEqual(catalog.video, { combos: ['My3'], directModels: ['google/veo-3'] });
  assert.throws(() => catalogFromPayload({ data: [] }), /tidak valid/);
});

test('backend returns grouped normalized catalog and test connection updates the shared health status', async () => {
  const {db,app}=setup(); const response=(await request(app).get('/api/ai/providers/9router/models').expect(200)).body;
  assert.deepEqual(response.text,catalog.text); assert.deepEqual(response.endpoints,CATALOG_PATHS);
  assert.deepEqual(new Set(calls.map(call=>call.url)),new Set(Object.keys(payloads))); assert.ok(calls.every(call=>call.options.headers.Authorization==='Bearer gateway-secret'));
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


test('saved gateway key is encrypted at rest, decrypted only for backend requests, and absent from browser responses', async () => {
  const {db,app}=setup(); const row=connector.setting(db,'9router');
  assert.notEqual(row.api_key_encrypted,'gateway-secret'); assert.equal(connector.configured(row).api_key,'gateway-secret');
  const publicProviders=(await request(app).get('/api/ai/providers').expect(200)).body;
  assert.equal(JSON.stringify(publicProviders).includes('gateway-secret'),false); assert.equal(publicProviders.find(provider=>provider.provider==='9router').apiKey,undefined);
  await request(app).get('/api/ai/providers/9router/models?refresh=true').expect(200);
  assert.equal(JSON.stringify(calls).includes('gateway-secret'),true);
});

test('masked credential is never persisted or sent and an empty gateway key is rejected', async () => {
  const {db,app}=setup(); const before=connector.setting(db,'9router').api_key_encrypted;
  await request(app).put('/api/ai/providers/9router').send({apiKey:'•••••••• (saved)'}).expect(200);
  assert.equal(connector.setting(db,'9router').api_key_encrypted,before);
  await request(app).get('/api/ai/providers/9router/models?refresh=true').expect(200);
  assert.ok(calls.every(call=>call.options.headers.Authorization==='Bearer gateway-secret'));
  assert.throws(()=>new NineRouterClient({api_key:'•••••••• (saved)'}),/belum dikonfigurasi/);
});

test('generation without a saved gateway key is rejected before history insertion', async () => {
  const db=createDatabase(':memory:'); connector.save(db,'9router',{enabled:true});
  await assert.rejects(connector.execute(db,{provider:'9router',model:'My1',prompt:'hello',mediaType:'text'},transport),/API key provider belum tersedia/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_generations').get().count,0);
  db.close();
});

test('shared client rejects an already-aborted parent signal without starting transport', async () => {
  const controller=new AbortController(); controller.abort(); let started=false;
  const client=new NineRouterClient({api_key:'gateway-secret'},async()=>{ started=true; return new Response('{}'); });
  await assert.rejects(client.request('/models',{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(started,false);
});

test('a cancelled 9Router request cannot continue into retry', async () => {
  const db=createDatabase(':memory:'); connector.save(db,'9router',{enabled:true,apiKey:'gateway-secret',retry:3}); let attempts=0;
  const pending=connector.execute(db,{id:'cancel-nine',provider:'9router',model:'My1',prompt:'hello',mediaType:'text'},async (_url,{signal})=>{
    attempts+=1;
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true}));
  });
  await new Promise(resolve=>setImmediate(resolve)); assert.equal(connector.cancel('cancel-nine'),true);
  const result=await pending; assert.equal(result.status,'Cancelled'); assert.equal(attempts,1); db.close();
});

test('test, refresh, and generation use the shared NineRouterClient authorization and timeout path', async () => {
  const {db,app}=setup();
  await request(app).post('/api/ai/providers/9router/test').expect(200);
  await request(app).get('/api/ai/providers/9router/models?refresh=true').expect(200);
  const provider=ProviderFactory.create(connector.configured(connector.setting(db,'9router')),transport);
  await provider.execute({model:'openai/gpt-5',mediaType:'text',prompt:'hello'});
  assert.ok(calls.every(call=>call.url.startsWith(API_BASE_URL) && !call.url.includes('20128') && call.options.headers.Authorization==='Bearer gateway-secret'));
  db.close();
});

test('returned My1/My2/My3 populate grouped dropdowns and empty groups render no heading', () => {
  assert.ok(catalog.text.combos.includes('My1')); assert.ok(catalog.image.combos.includes('My2')); assert.ok(catalog.video.combos.includes('My3'));
  const providers=fs.readFileSync('public/ai-providers.js','utf8'), studio=fs.readFileSync('public/content-studio.js','utf8');
  assert.match(providers,/items\.length\?/); assert.match(studio,/models\.length\?/);
});
