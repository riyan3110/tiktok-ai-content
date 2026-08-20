const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { buildGenerationRequest } = require('../src/ai/requestBuilder');

const response = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });

test('request builder normalizes media parameters and supported assets', () => {
  const result = buildGenerationRequest({ prompt: 'Animate this product', mediaType: 'video', duration: 5, assets: [{ type: 'reference-product', url: 'https://assets.example/product.png' }] }, { default_model: 'video-v1' });
  assert.equal(result.mediaType, 'video'); assert.equal(result.model, 'video-v1'); assert.equal(result.parameters.duration, 5); assert.equal(result.assets[0].type, 'reference-product');
});

test('real media response and metadata are persisted and exposed by result viewer API', async () => {
  const db = createDatabase(':memory:'); const transport = async () => response({ id: 'provider-42', output: 'done', media: [{ type: 'image', url: 'https://cdn.example/ad.png' }] }); const app = createApp({ db, aiTransport: transport });
  await request(app).put('/api/ai/providers/openai-images').send({ apiKey: 'secret', enabled: true });
  const generated = await request(app).post('/api/ai/generations').send({ provider: 'openai-images', prompt: 'Create product ad', mediaType: 'image', assets: [{ type: 'reference-product', url: 'https://assets.example/item.png' }] });
  assert.equal(generated.status, 202); assert.equal(generated.body.status, 'Completed'); assert.equal(generated.body.media_type, 'image');
  const detail = await request(app).get(`/api/ai/generations/${generated.body.id}`); assert.equal(detail.body.media[0].url, 'https://cdn.example/ad.png'); assert.equal(detail.body.provider_job_id, 'provider-42'); assert.ok(detail.body.duration_ms >= 0);
});

test('batch endpoint accepts multiple jobs for background worker', async () => {
  const db = createDatabase(':memory:'); const app = createApp({ db, aiTransport: async () => response({ output: 'ok' }) }); await request(app).put('/api/ai/providers/openai-images').send({ apiKey: 'secret', enabled: true });
  const batch = await request(app).post('/api/ai/generations/batch').send({ jobs: [{ provider: 'openai-images', prompt: 'one' }, { provider: 'openai-images', prompt: 'two' }] }); assert.equal(batch.status, 202); assert.equal(batch.body.ids.length, 2);
});
