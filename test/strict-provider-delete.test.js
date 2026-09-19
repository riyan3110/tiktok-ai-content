process.env.SESSION_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const dynamicAi = require('../src/services/dynamicAiProviders');
const { install: installStrictProviderDelete } = require('../src/services/strictProviderDelete');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function fixture(t) {
  const db = createDatabase(':memory:');
  const calls = [];
  const transport = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || 'GET', body: options.body });
    if (String(options.headers?.Authorization || '').startsWith('Bearer invalid-')) return jsonResponse({ error: 'invalid key' }, 401);
    if (target.endsWith('/models')) {
      if (target.includes('one.local')) return jsonResponse({ data: [{ id: 'one-a' }, { id: 'one-b' }] });
      if (target.includes('two.local')) return jsonResponse({ data: [{ id: 'two-a' }, { id: 'two-b' }] });
    }
    if (target.includes('one.local') && target.endsWith('/chat/completions')) return jsonResponse({ error: 'one failed' }, 500);
    if (target.includes('two.local') && target.endsWith('/chat/completions')) {
      const body = JSON.parse(options.body || '{}');
      return jsonResponse({ model: body.model, choices: [{ message: { content: `two:${body.model}` } }] });
    }
    return jsonResponse({ error: `unexpected ${target}` }, 404);
  };

  const app = express();
  app.use(express.json());
  installStrictProviderDelete({ app, db, dynamicAi });
  dynamicAi.install({ app, db, transport });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(Number(error?.status) || 500).json({ error: error?.message || 'error' });
  });
  t.after(() => db.close());
  return { db, app, calls };
}

async function saveText(app, baseUrl, apiKey) {
  return (await request(app).post('/api/dynamic-ai/providers').send({ role: 'text', baseUrl, apiKey }).expect(res => {
    assert.ok([200, 201].includes(res.status));
  })).body.saved;
}

test('deleting the active provider leaves Text AI unselected instead of auto-activating another saved provider', async t => {
  const { db, app, calls } = fixture(t);
  const one = await saveText(app, 'https://one.local/v1', 'key-one');
  const two = await saveText(app, 'https://two.local/v1', 'key-two');
  await request(app).put('/api/dynamic-ai/defaults/text').send({ providerId: one.id, model: 'one-b' }).expect(200);

  const before = await request(app).get('/api/dynamic-ai/providers').expect(200);
  assert.equal(before.body.defaults.text.providerId, one.id);
  assert.equal(before.body.defaults.text.fallbackEnabled, false);

  const deleted = await request(app).delete(`/api/dynamic-ai/providers/${one.id}`).expect(200);
  assert.equal(deleted.body.defaults.text.providerId, null);
  assert.equal(deleted.body.defaults.text.model, null);
  assert.equal(deleted.body.defaults.text.fallbackEnabled, false);
  assert.equal(deleted.body.providers.some(provider => provider.id === one.id), false);
  assert.equal(deleted.body.providers.some(provider => provider.id === two.id), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ai_dynamic_provider_profiles WHERE id=?').get(one.id).total, 0);

  const chatCallsBefore = calls.filter(call => call.url.endsWith('/chat/completions')).length;
  await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'jangan pakai provider lain' }).expect(409);
  const chatCallsAfter = calls.filter(call => call.url.endsWith('/chat/completions')).length;
  assert.equal(chatCallsAfter, chatCallsBefore, 'remaining provider must not run silently after delete');
});

test('fallback state changes only through the explicit fallback switch and cannot run without an explicitly selected provider', async t => {
  const { app, calls } = fixture(t);
  const one = await saveText(app, 'https://one.local/v1', 'key-one');
  const two = await saveText(app, 'https://two.local/v1', 'key-two');
  await request(app).put('/api/dynamic-ai/defaults/text').send({ providerId: one.id, model: 'one-a' }).expect(200);

  const enabled = await request(app).put('/api/dynamic-ai/fallback').send({ role: 'text', enabled: true }).expect(200);
  assert.equal(enabled.body.defaults.text.fallbackEnabled, true);

  const deleted = await request(app).delete(`/api/dynamic-ai/providers/${one.id}`).expect(200);
  assert.equal(deleted.body.defaults.text.providerId, null);
  assert.equal(deleted.body.defaults.text.model, null);
  assert.equal(deleted.body.defaults.text.fallbackEnabled, true, 'delete must not secretly toggle the user switch');

  const before = calls.filter(call => call.url.endsWith('/chat/completions')).length;
  await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'fallback tidak boleh jalan sendiri' }).expect(409);
  assert.equal(calls.filter(call => call.url.endsWith('/chat/completions')).length, before);

  await request(app).put('/api/dynamic-ai/defaults/text').send({ providerId: two.id, model: 'two-b' }).expect(200);
  const generated = await request(app).post('/api/dynamic-ai/generate').send({ prompt: 'provider dipilih manual' }).expect(200);
  assert.equal(generated.body.providerId, two.id);
  assert.equal(generated.body.model, 'two-b');
  assert.equal(generated.body.text, 'two:two-b');

  const disabled = await request(app).put('/api/dynamic-ai/fallback').send({ role: 'text', enabled: false }).expect(200);
  assert.equal(disabled.body.defaults.text.fallbackEnabled, false);
});

test('deleting a non-selected provider does not change the selected provider, model, or fallback switch', async t => {
  const { app } = fixture(t);
  const one = await saveText(app, 'https://one.local/v1', 'key-one');
  const two = await saveText(app, 'https://two.local/v1', 'key-two');
  await request(app).put('/api/dynamic-ai/defaults/text').send({ providerId: one.id, model: 'one-b' }).expect(200);
  await request(app).put('/api/dynamic-ai/fallback').send({ role: 'text', enabled: true }).expect(200);

  const deleted = await request(app).delete(`/api/dynamic-ai/providers/${two.id}`).expect(200);
  assert.equal(deleted.body.defaults.text.providerId, one.id);
  assert.equal(deleted.body.defaults.text.model, 'one-b');
  assert.equal(deleted.body.defaults.text.fallbackEnabled, true);
});

test('deleting a failing primary during its request cannot activate fallback', async t => {
  const db=createDatabase(':memory:'); t.after(()=>db.close());
  const app=express();app.use(express.json());
  let release,started;const ready=new Promise(resolve=>{started=resolve;});const calls=[];
  const transport=async(url,options={})=>{
    if(String(options.headers?.Authorization).startsWith('Bearer invalid-'))return jsonResponse({},401);
    if(url.endsWith('/models'))return jsonResponse({data:[{id:'model'}]});
    calls.push(url);
    if(url.includes('one.local')){started();await new Promise(resolve=>{release=resolve;});return jsonResponse({},500);}
    return jsonResponse({choices:[{message:{content:'must not run'}}]});
  };
  dynamicAi.install({app,db,transport});
  const one=await saveText(app,'https://one.local/v1','one');
  await saveText(app,'https://two.local/v1','two');
  await request(app).put('/api/dynamic-ai/defaults/text').send({providerId:one.id,model:'model'}).expect(200);
  await request(app).put('/api/dynamic-ai/fallback').send({role:'text',enabled:true}).expect(200);
  const pending=dynamicAi.execute(db,'test',transport);
  await ready; dynamicAi.removeProvider(db,one.id);release();
  await assert.rejects(pending);
  assert.equal(calls.length,1);
});

test('Image fallback ON tries saved image provider and OFF stops after the primary failure', async t=>{
  const db=createDatabase(':memory:');t.after(()=>db.close());
  const app=express();app.use(express.json());const calls=[];
  const transport=async(url,options={})=>{
    if(String(options.headers?.Authorization).startsWith('Bearer invalid-'))return jsonResponse({},401);
    if(url.endsWith('/models'))return jsonResponse({data:[{id:'image-model'}]});
    calls.push(url);
    return url.includes('one.local')?jsonResponse({},500):jsonResponse({data:[{url:'https://result.invalid/image.png'}]});
  };
  dynamicAi.install({app,db,transport});
  let one;
  for(const name of ['one','two']){
    const saved=(await request(app).post('/api/dynamic-ai/providers').send({role:'image',baseUrl:`https://${name}.local/v1`,apiKey:name}).expect(201)).body.saved;
    if(name==='one')one=saved;
  }
  await request(app).put('/api/dynamic-ai/defaults/image').send({providerId:one.id,model:'image-model'}).expect(200);
  await assert.rejects(dynamicAi.executeImage(db,'test',{},transport));assert.equal(calls.length,1);
  await request(app).put('/api/dynamic-ai/fallback').send({role:'image',enabled:true}).expect(200);
  const result=await dynamicAi.executeImage(db,'test',{},transport);assert.notEqual(result.providerId,one.id);assert.equal(calls.length,3);
  await request(app).put('/api/dynamic-ai/fallback').send({role:'image',enabled:false}).expect(200);
  await assert.rejects(dynamicAi.executeImage(db,'test',{},transport));assert.equal(calls.length,4);
});
