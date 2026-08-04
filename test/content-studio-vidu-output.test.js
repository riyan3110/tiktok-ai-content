const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

const response = body => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) });

test('Content Studio always sends TikTok output parameters to Vidu', async () => {
  const db = createDatabase(':memory:');
  const requests = [];
  const app = createApp({ db, aiTransport: async (url, options) => {
    if (options.method === 'POST') requests.push(JSON.parse(options.body));
    return response(url.endsWith('/creations') ? { state: 'success', creations: [{ url: 'https://cdn.test/video.mp4' }] } : { task_id: 'task-1' });
  } });
  await request(app).put('/api/ai/providers/vidu').send({ apiKey: 'secret', enabled: true }).expect(200);

  const generated = await request(app).post('/api/content-studio/generate').send({
    provider: 'vidu', model: 'viduq3-turbo', prompt: 'Vertical product reveal', mediaType: 'video', resolution: '1920×1080'
  }).expect(202);

  for (let attempt = 0; attempt < 30 && !requests.length; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(requests[0].aspect_ratio, '9:16');
  assert.equal(requests[0].resolution, '1080p');
  await request(app).post(`/api/ai/jobs/${generated.body.ids[0]}/cancel`).expect(202);
  await new Promise(resolve => setTimeout(resolve, 20));
});
