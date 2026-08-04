const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

const response = body => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });

async function generate(body, { makeDefault = false } = {}) {
  const db = createDatabase(':memory:');
  const requests = [];
  const app = createApp({ db, aiTransport: async (url, options) => {
    if (options.method === 'POST') requests.push(JSON.parse(options.body));
    return response(url.endsWith('/creations') ? { state: 'success', creations: [{ url: 'https://cdn.test/video.mp4' }] } : { task_id: 'task-1' });
  } });
  await request(app).put('/api/ai/providers/vidu').send({ apiKey: 'secret', enabled: true, isDefault: makeDefault, defaultCapability: 'video' }).expect(200);
  const generated = await request(app).post('/api/content-studio/generate').send({ model: 'viduq3-turbo', prompt: 'Vertical product reveal', mediaType: 'video', ...body }).expect(202);
  for (let attempt = 0; attempt < 30 && !requests.length; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
  await request(app).post(`/api/ai/jobs/${generated.body.ids[0]}/cancel`).expect(202);
  await new Promise(resolve => setTimeout(resolve, 20));
  return requests[0];
}

const assertTikTokOutput = body => {
  assert.equal(body.aspect_ratio, '9:16');
  assert.equal(body.resolution, '1080p');
};

test('Content Studio replaces a legacy top-level Vidu resolution', async () => {
  assertTikTokOutput(await generate({ provider: 'vidu', resolution: '1920×1080' }));
});

test('Content Studio prevents nested Vidu parameters from overriding TikTok output', async () => {
  assertTikTokOutput(await generate({ provider: 'vidu', parameters: { aspectRatio: '16:9', resolution: '4K' } }));
});

test('Content Studio normalizes output when Vidu is the resolved default provider', async () => {
  assertTikTokOutput(await generate({}, { makeDefault: true }));
});
