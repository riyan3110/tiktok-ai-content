const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const connector = require('../src/ai/connector');
const { normalize } = require('../src/services/orcaRouterModels');

const modelPayload = { data: [
  { id: 'chat/text-only', capabilities: ['text'] },
  { id: 'openai/gpt-image-1.5', capabilities: { image: true } },
  { id: 'kling/kling-v3', supported_modalities: ['video'] }
] };
const enable = db => connector.save(db, 'orcarouter', { apiKey: 'server-secret', enabled: true });

test('OrcaRouter models are normalized by metadata and fetched server-side with a cached secret', async () => {
  const db = createDatabase(':memory:'); enable(db); let calls = 0;
  const app = createApp({ db, aiTransport: async (url, options) => { calls += 1; assert.equal(url, 'https://api.orcarouter.ai/v1/models'); assert.equal(options.headers.Authorization, 'Bearer server-secret'); return new Response(JSON.stringify(modelPayload)); } });
  const first = (await request(app).get('/api/ai/providers/orcarouter/models').expect(200)).body;
  const second = (await request(app).get('/api/ai/providers/orcarouter/models').expect(200)).body;
  assert.deepEqual(first.image, ['openai/gpt-image-1.5']); assert.deepEqual(first.video, ['kling/kling-v3']); assert.deepEqual(first.text, ['chat/text-only']);
  assert.equal(JSON.stringify(first).includes('server-secret'), false); assert.deepEqual(second, first); assert.equal(calls, 1); db.close();
});

test('model endpoint returns capability-safe fallback when OrcaRouter listing fails', async () => {
  const db = createDatabase(':memory:'); enable(db); const app = createApp({ db, aiTransport: async () => { throw new Error('offline'); } });
  const body = (await request(app).get('/api/ai/providers/orcarouter/models').expect(200)).body;
  assert.equal(body.fallback, true); assert.equal(body.error, 'Daftar model OrcaRouter gagal dimuat.'); assert.ok(body.image.includes('openai/gpt-image-1')); assert.ok(body.video.includes('kling/kling-v3')); db.close();
});

test('selected OrcaRouter image model is sent unchanged and persisted in generation history', async () => {
  const db = createDatabase(':memory:'); enable(db); const bodies = [];
  const app = createApp({ db, aiTransport: async (url, options = {}) => {
    if (url.endsWith('/v1/models')) return new Response(JSON.stringify(modelPayload));
    bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify({ data: [{ url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] }));
  } });
  const generated = (await request(app).post('/api/content-studio/generate').send({ provider: 'orcarouter', mediaType: 'image', model: 'openai/gpt-image-1.5', prompt: 'poster' }).expect(202)).body;
  for (let tries = 0; tries < 30 && !bodies.length; tries += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(bodies[0].model, 'openai/gpt-image-1.5');
  let history; for (let tries = 0; tries < 50; tries += 1) { history = (await request(app).get(`/api/content-studio/jobs/${generated.ids[0]}`).expect(200)).body; if (['Completed','Failed'].includes(history.status)) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(history.model, 'openai/gpt-image-1.5'); db.close();
});

test('Content Studio selector keeps image/video choices separate and provides loading, empty, retry, disabled, and mobile states', () => {
  const html = fs.readFileSync('public/index.html', 'utf8'); const script = fs.readFileSync('public/content-studio.js', 'utf8'); const css = fs.readFileSync('public/style.css', 'utf8');
  assert.match(html, /studio-orcarouter-model/); assert.match(html, />Coba lagi</);
  assert.match(script, /contentStudio\.orcarouter\.imageModel/); assert.match(script, /contentStudio\.orcarouter\.videoModel/);
  assert.match(script, /Memuat model OrcaRouter…/); assert.match(script, /Tidak ada model gambar OrcaRouter/); assert.match(script, /Tidak ada model video OrcaRouter/);
  assert.match(script, /disabled=empty\|\|!modelsReady/); assert.match(script, /studio-orcarouter-model'\)\.value/);
  assert.match(css, /max-width:100%/); assert.match(css, /text-overflow:ellipsis/); assert.match(css, /@media\(max-width:767px\).*studio-model-select/);
  assert.deepEqual(normalize(modelPayload), { text: ['chat/text-only'], image: ['openai/gpt-image-1.5'], video: ['kling/kling-v3'] });
});
