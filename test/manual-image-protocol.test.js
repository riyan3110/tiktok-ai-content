process.env.SESSION_SECRET ||= 'manual-image-protocol-test-session';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const dynamic = require('../src/services/dynamicAiProviders');
const { generate, outputSettings } = require('../src/services/manualImageProtocol');
const json = (body, status=200) => new Response(JSON.stringify(body), {status});

for (const format of ['openai','chat','gemini','vidu','router-images']) {
  test(`${format}: saving tests image output without requiring /models, runtime reuses exact credentials, delete clears selection`, async t => {
    const db=createDatabase(':memory:'); t.after(()=>db.close());
    const calls=[];
    const transport=async(url,init)=>{
      const body=init.body?JSON.parse(init.body):null;
      calls.push({url:String(url),headers:init.headers,body});
      assert.ok(!String(url).endsWith('/models'));
      if(body) assert.equal(body.model || decodeURIComponent(String(url).split('/models/')[1]?.split(':')[0]), 'my-image-model');
      if(format==='vidu') {
        assert.equal(init.headers.Authorization, 'Token test-key');
        return json(body?{task_id:'task-1'}:{state:'success',creations:[{url:'https://cdn.example/image.png'}]});
      }
      if(format==='gemini') {
        assert.equal(init.headers['x-goog-api-key'],'test-key');
        return json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'aW1hZ2U='}}]}}]});
      }
      assert.equal(init.headers.Authorization,'Bearer test-key');
      return json(format==='chat'?{choices:[{message:{images:[{image_url:{url:'data:image/png;base64,aW1hZ2U='}}]}}]}:{data:[{b64_json:'aW1hZ2U='}]});
    };
    const app=express(); app.use(express.json()); dynamic.install({app,db,transport});
    app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
    const saved=await request(app).post('/api/dynamic-ai/providers').send({role:'image',baseUrl:'https://custom.example/v1',apiKey:'test-key',imageProtocol:format,imageModel:'my-image-model',testImage:true}).expect(201);
    assert.deepEqual(saved.body.saved.models,['my-image-model']);
    assert.equal(saved.body.providers[0].imageProtocol,format);
    const result=await dynamic.executeImage(db,'real prompt',{},transport);
    assert.equal(result.requestedModel,'my-image-model');
    assert.ok(result.url||result.b64Json);
    await request(app).delete(`/api/dynamic-ai/providers/${saved.body.saved.id}`).expect(200);
    assert.equal(dynamic.publicState(db).defaults.image.providerId,null);
    const before=calls.length;
    await assert.rejects(()=>dynamic.executeImage(db,'again',{},transport));
    assert.equal(calls.length,before);
  });
}

test('portrait and landscape UI resolutions normalize to provider-safe image settings', () => {
  assert.deepEqual(outputSettings('1080×1920', 'gpt-image-1'), { aspectRatio: '9:16', openAiSize: '1024x1536', imageSize: null });
  assert.deepEqual(outputSettings('1920×1080', 'gpt-image-1'), { aspectRatio: '16:9', openAiSize: '1536x1024', imageSize: null });
  assert.deepEqual(outputSettings('1024×1024', 'gpt-image-1'), { aspectRatio: '1:1', openAiSize: '1024x1024', imageSize: null });
  assert.deepEqual(outputSettings('1080×1920', 'dall-e-3'), { aspectRatio: '9:16', openAiSize: '1024x1792', imageSize: null });
  assert.deepEqual(outputSettings('4K', 'gemini-image'), { aspectRatio: '16:9', openAiSize: '1536x1024', imageSize: '4K' });
});

test('manual image API formats receive portrait orientation instead of silently ignoring resolution', async () => {
  for (const format of ['router-images', 'chat', 'gemini', 'vidu']) {
    let firstBody = null;
    const transport = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      if (body && !firstBody) firstBody = body;
      if (format === 'vidu') return json(body ? { task_id: 'portrait-task' } : { state: 'success', creations: [{ url: 'https://cdn.example/portrait.png' }] });
      if (format === 'gemini') return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] });
      if (format === 'chat') return json({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }] } }] });
      return json({ data: [{ b64_json: 'aW1hZ2U=' }] });
    };
    await generate({ baseUrl: 'https://custom.example/v1', apiKey: 'key', model: 'image-model', format, prompt: 'portrait ad', size: '1080×1920' }, transport);
    if (format === 'router-images') assert.equal(firstBody.size, '1024x1536');
    if (format === 'chat') assert.equal(firstBody.image_config.aspect_ratio, '9:16');
    if (format === 'gemini') assert.equal(firstBody.generationConfig.imageConfig.aspectRatio, '9:16');
    if (format === 'vidu') assert.equal(firstBody.aspect_ratio, '9:16');
  }
});

test('failed image validation never saves a provider or selects a model', async t=>{
  const db=createDatabase(':memory:');t.after(()=>db.close());
  const app=express();app.use(express.json());dynamic.install({app,db,transport:async()=>json({error:'denied'},401)});
  app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
  await request(app).post('/api/dynamic-ai/providers').send({role:'image',baseUrl:'https://custom.example',apiKey:'wrong',imageModel:'chosen',testImage:true}).expect(401);
  assert.deepEqual(dynamic.publicState(db).providers,[]);
});

test('Vidu task polling honors cancellation instead of returning pending tasks as images', async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(()=>generate({baseUrl:'https://custom.example',apiKey:'key',model:'chosen',format:'vidu',prompt:'test',signal:controller.signal},async()=>{
    calls++;if(calls===1)return json({task_id:'pending'});
    controller.abort();return json({state:'processing'});
  }),{name:'AbortError'});
  assert.equal(calls,2);
});

test('text-only response cannot validate an image model', async t=>{
  const db=createDatabase(':memory:');t.after(()=>db.close());
  const app=express();app.use(express.json());dynamic.install({app,db,transport:async()=>json({choices:[{message:{content:'not an image'}}]})});
  app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
  await request(app).post('/api/dynamic-ai/providers').send({role:'image',baseUrl:'https://custom.example',apiKey:'key',imageProtocol:'chat',imageModel:'text-only',testImage:true}).expect(502);
  assert.deepEqual(dynamic.publicState(db).providers,[]);
});

test('dark theme text meets 4.5:1 contrast on every themed card surface',()=>{
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/runtime-ui-fixes.js'),'utf8');
  const palette=Object.fromEntries([...source.matchAll(/--neo-([a-z]+):(#\w{6});/g)].map(m=>[m[1],m[2]]));
  function luminance(hex){const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;}
  for(const text of ['ink','muted'])for(const background of ['paper','white','soft','lime','yellow','purple','blue','mint','peach','pink','danger']){
    const a=luminance(palette[text]),b=luminance(palette[background]);
    assert.ok((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)>=4.5,`${text} on ${background}`);
  }
});
