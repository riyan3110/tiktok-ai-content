process.env.SESSION_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const dynamic = require('../src/services/dynamicAiProviders');
const connector = require('../src/ai/connector');

function fixture(t) {
  const db = createDatabase(':memory:');
  const app = createApp({ db });
  dynamic.install({ app, db });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  t.after(() => db.close());
  return { db, app };
}

test('legacy rows cannot appear or run even when inserted after cleanup', async t => {
  const { db, app } = fixture(t);
  for (const id of ['orcarouter','9router','vidu','openai-images','zark','nanobanana']) {
    db.prepare('INSERT INTO ai_provider_settings(provider,base_url,api_key_encrypted,default_model,enabled) VALUES(?,?,?,?,1)').run(id, 'https://old.invalid/v1', 'old-key', 'ghost-model');
  }
  for (const url of ['/api/providers','/api/ai/providers','/api/content-studio/providers']) {
    const response = await request(app).get(url).expect(200);
    assert.deepEqual(response.body, []);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  for (const mediaType of ['text','image','video']) {
    assert.throws(() => connector.validateGeneration(db, { mediaType, provider:'9router', model:'ghost-model', prompt:'test' }), { status:409 });
  }
  await request(app).get('/api/ai/providers/orcarouter/models').expect(410);
  await request(app).post('/api/providers/save').send({provider:'9router',enabled:true}).expect(410);
});

test('real HTTP requests use saved credentials and selected model, then deletion prevents further requests', async t => {
  const calls=[];
  const server=http.createServer(async(req,res)=>{
    let raw=''; for await(const part of req) raw+=part;
    calls.push({path:req.url,key:req.headers.authorization,body:raw?JSON.parse(raw):null});
    res.setHeader('Content-Type','application/json');
    if(!['Bearer text-secret','Bearer image-secret'].includes(req.headers.authorization)){res.writeHead(401);return res.end('{"error":"invalid key"}');}
    if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'model-a'},{id:'model-b'}]}));
    const model=JSON.parse(raw).model;
    if(req.url==='/v1/chat/completions')return res.end(JSON.stringify({model,choices:[{message:{content:'HTTP text result'}}]}));
    if(req.url==='/v1/images/generations')return res.end(JSON.stringify({model,data:[{b64_json:'aW1hZ2U='}]}));
    res.writeHead(404);res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {db,app}=fixture(t),baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
  for(const role of ['text','image']){
    const saved=(await request(app).post('/api/dynamic-ai/providers').send({role,baseUrl,apiKey:`${role}-secret`}).expect(201)).body.saved;
    await request(app).put(`/api/dynamic-ai/defaults/${role}`).send({providerId:saved.id,model:'model-b'}).expect(200);
    const result=await connector.execute(db,{mediaType:role,provider:saved.id,model:'model-b',prompt:'HTTP integration test'});
    assert.equal(result.provider,saved.id);assert.equal(result.model,'model-b');assert.equal(result.status,'Completed');
    const call=calls.at(-1);assert.equal(call.key,`Bearer ${role}-secret`);assert.equal(call.body.model,'model-b');
    assert.equal(call.path,role==='text'?'/v1/chat/completions':'/v1/images/generations');
    const before=calls.length;
    await request(app).post('/api/content-studio/generate').send({mediaType:'image',provider:'9router',model:'ghost',prompt:'old UI'}).expect(409);
    assert.equal(calls.length,before);
    await request(app).delete(`/api/dynamic-ai/providers/${saved.id}`).expect(200);
    await assert.rejects(connector.execute(db,{mediaType:role,prompt:'after delete'}),{status:409});
    assert.equal(calls.length,before);
  }
  assert.deepEqual((await request(app).get('/api/content-studio/providers')).body,[]);
});

test('retired adapters and frontend catalog loaders are physically removed',()=>{
  for(const file of ['src/providers/OrcaRouterProvider.js','src/providers/NineRouterProvider.js','src/providers/ViduProvider.js','src/providers/GeminiProvider.js','src/providers/OpenAIProvider.js','src/providers/index.js','src/ai/adapters.js','src/services/orcaRouterModels.js','src/services/nineRouterModels.js','public/content-studio-vidu-models.js']) assert.equal(fs.existsSync(file),false,file);
  const script=fs.readFileSync('public/content-studio.js','utf8');
  assert.doesNotMatch(script,/orcarouter|9router|viduModels|loadOrcaModels|loadNineModels/);
  assert.match(script,/\/api\/dynamic-ai\/providers/);
  assert.match(script,/\/api\/dynamic-ai\/defaults/);
});
