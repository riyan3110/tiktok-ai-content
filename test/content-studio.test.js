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

test('Content Studio refreshes stored media previews before rendering history', () => {
  const script = fs.readFileSync('public/content-studio.js', 'utf8');
  assert.match(script, /api\('\/api\/assets\/resolve'/);
  assert.match(script, /assetIds:ids/);
  assert.match(script, /asset\.preview_url\|\|asset\.url/);
  assert.match(script, /jobs=await refreshResultUrls\(jobs\)/);
});

test('Content Studio queues image jobs, keeps history, duplicates, retries, and deletes', async () => {
  const db = createDatabase(':memory:'); const app = createApp({ db, aiTransport: async () => response({ output: 'generated' }) });
  await request(app).put('/api/ai/providers/openai-images').send({ apiKey: 'secret', enabled: true }).expect(200);
  const generated = await request(app).post('/api/content-studio/generate').send({ provider: 'openai-images', prompt: 'Premium product photo', negativePrompt: 'blur', mediaType: 'image', resolution: '1024×1024' }).expect(202);
  const job = await waitFor(app, generated.body.ids[0], 'Completed'); assert.equal(job.negative_prompt, 'blur'); assert.equal(job.progress, 100);
  const history = await request(app).get('/api/content-studio/jobs?search=premium&type=image').expect(200); assert.equal(history.body.length, 1);
  const duplicate = await request(app).post(`/api/content-studio/jobs/${job.id}/duplicate`).expect(202); await waitFor(app, duplicate.body.id, 'Completed');
  const retry = await request(app).post(`/api/content-studio/jobs/${job.id}/retry`).expect(202); await waitFor(app, retry.body.id, 'Completed');
  await request(app).delete(`/api/content-studio/jobs/${job.id}`).expect(200); await request(app).get(`/api/content-studio/jobs/${job.id}`).expect(404); db.close();
});

test('Content Studio menyediakan selector background carousel yang persisten dan mobile-safe', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const script = fs.readFileSync('public/app.js', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  for (const value of ['Background Konten', '#0B0B0D', '#FFFFFF', '#E9E1D3', 'Unggah dari perangkat', 'Terapkan ke semua slide', 'Reset Background', 'accept="image/png,image/jpeg,image/webp"']) assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const value of ['10 * 1024 * 1024', 'localStorage.setItem', 'slideBackgrounds', '/api/assets/upload', 'imageTextColor', 'background: carouselBackground']) assert.match(script, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(css, /background-size:cover/);
  assert.match(css, /grid-template-columns:repeat\(3/);
});


test('live carousel preview memakai layer terlihat lalu menggantinya dengan JPEG render terbaru', () => {
  const script = fs.readFileSync('public/app.js', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  assert.match(script, /<img[^>]+><span class="slide-background-preview"/);
  assert.match(script, /layer\.classList\.add\('pending'\)/);
  assert.match(script, /contents\/\$\{current\.id\}\/background/);
  assert.match(script, /image\.src = `\$\{updated\.slides\[index\]\}/);
  assert.match(css, /\.slide-background-preview\{position:absolute;inset:0;z-index:2/);
  assert.match(css, /\.slide-button>img\{position:relative;z-index:1/);
});

test('live preview membatalkan request lama dan membersihkan overlay pada error legacy', () => {
  const script = fs.readFileSync('public/app.js', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  assert.match(script, /schedulePreviewRender\.controller\?\.abort\(\)/);
  assert.match(script, /version !== schedulePreviewRender\.version/);
  assert.match(script, /signal: schedulePreviewRender\.controller\.signal/);
  assert.match(script, /slide-background-preview'\)\.forEach\(layer => layer\.classList\.remove\('pending'\)\)/);
});