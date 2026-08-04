const test = require('node:test');
const assert = require('node:assert/strict');
const ViduProvider = require('../src/providers/ViduProvider');

const response = body => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
const config = { provider: 'vidu', base_url: 'https://api.vidu.test', api_key: 'secret', default_model: 'vidu2.0', video_poll_interval_ms: 1 };

test('Vidu text2video submits once and polls creations with Token authorization', async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return response({ task_id: 'task/one' });
    return response(calls.length === 2 ? { state: 'processing' } : { state: 'success', creations: [{ url: 'https://cdn.test/video.mp4' }] });
  };
  const provider = new ViduProvider(config, transport);
  const result = await provider.execute({ mediaType: 'video', prompt: 'A product reveal', parameters: { aspectRatio: '9:16', duration: 5 } });

  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(calls[0].url, 'https://api.vidu.test/ent/v2/text2video');
  assert.equal(calls[0].options.headers.Authorization, 'Token secret');
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'vidu2.0', prompt: 'A product reveal', duration: 5, aspect_ratio: '9:16' });
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[1].url, 'https://api.vidu.test/ent/v2/tasks/task%2Fone/creations');
  assert.equal(result.providerJobId, 'task/one');
  assert.deepEqual(result.media, [{ url: 'https://cdn.test/video.mp4' }]);
});

test('Vidu img2video sends image URLs and then only polls with GET', async () => {
  const calls = [];
  const provider = new ViduProvider(config, async (url, options) => {
    calls.push({ url, options });
    return response(options.method === 'POST' ? { task_id: 'image-task' } : { status: 'success', creations: [{ url: 'https://cdn.test/animated.mp4' }] });
  });
  await provider.execute({ mediaType: 'video', prompt: 'Animate it', assets: [{ type: 'image', url: 'https://cdn.test/source.png' }], parameters: {} });

  assert.equal(calls[0].url, 'https://api.vidu.test/ent/v2/img2video');
  assert.deepEqual(JSON.parse(calls[0].options.body).images, ['https://cdn.test/source.png']);
  assert.deepEqual(calls.map(call => call.options.method), ['POST', 'GET']);
});

test('Vidu forwards AbortSignal and stops polling when aborted', async () => {
  const controller = new AbortController();
  const calls = [];
  const provider = new ViduProvider({ ...config, video_poll_interval_ms: 50 }, async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      controller.abort();
      return response({ task_id: 'cancelled-task' });
    }
    throw new Error('poll must not run');
  });

  await assert.rejects(provider.execute({ mediaType: 'video', prompt: 'Stop', parameters: {} }, { signal: controller.signal }), error => error.type === 'Timeout');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal, controller.signal);
});
