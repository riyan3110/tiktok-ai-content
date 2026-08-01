const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

const response = body => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });
const waitFor = async (app, id, expected) => { for (let attempt = 0; attempt < 30; attempt += 1) { const result = await request(app).get(`/api/content-studio/jobs/${id}`); if (result.body.status === expected) return result.body; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error(`Job ${id} tidak menjadi ${expected}`); };

test('Content Studio UI provides generation, batch, realtime queue, history, and result actions', () => {
  const html = fs.readFileSync('public/index.html', 'utf8'); const script = fs.readFileSync('public/content-studio.js', 'utf8');
  for (const text of ['Image Generation', 'Video Generation', 'Batch Generation', 'History', 'Negative Prompt', 'Reference assets']) assert.match(html, new RegExp(text));
  for (const action of ['download', 'duplicate', 'retry', 'Copy URL', 'Delete']) assert.match(script, new RegExp(action, 'i'));
});

test('Content Studio queues image jobs, keeps history, duplicates, retries, and deletes', async () => {
  const db = createDatabase(':memory:'); const app = createApp({ db, aiTransport: async () => response({ output: 'generated' }) });
  await request(app).put('/api/ai/providers/openai').send({ apiKey: 'secret', enabled: true }).expect(200);
  const generated = await request(app).post('/api/content-studio/generate').send({ provider: 'openai', prompt: 'Premium product photo', negativePrompt: 'blur', mediaType: 'image', resolution: '1024×1024' }).expect(202);
  const job = await waitFor(app, generated.body.ids[0], 'Completed'); assert.equal(job.negative_prompt, 'blur'); assert.equal(job.progress, 100);
  const history = await request(app).get('/api/content-studio/jobs?search=premium&type=image').expect(200); assert.equal(history.body.length, 1);
  const duplicate = await request(app).post(`/api/content-studio/jobs/${job.id}/duplicate`).expect(202); await waitFor(app, duplicate.body.id, 'Completed');
  const retry = await request(app).post(`/api/content-studio/jobs/${job.id}/retry`).expect(202); await waitFor(app, retry.body.id, 'Completed');
  await request(app).delete(`/api/content-studio/jobs/${job.id}`).expect(200); await request(app).get(`/api/content-studio/jobs/${job.id}`).expect(404); db.close();
});
