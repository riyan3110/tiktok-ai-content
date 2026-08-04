const test = require('node:test');
const assert = require('node:assert/strict');
const ViduProvider = require('../src/providers/ViduProvider');
const { ProviderFactory } = require('../src/providers');
const connector = require('../src/ai/connector');
const { createDatabase } = require('../src/db');

const response = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  headers: { get: () => null },
  json: async () => body,
  text: async () => typeof body === 'string' ? body : JSON.stringify(body)
});
const config = { provider: 'vidu', base_url: 'https://api.vidu.test', api_key: 'secret', default_model: 'viduq3-turbo', video_poll_interval_ms: 1 };

const successfulTransport = calls => async (url, options) => {
  calls.push({ url, options });
  return response(options.method === 'POST' ? { task_id: 'task-id' } : { state: 'success', creations: [{ url: 'https://cdn.test/video.mp4' }] });
};

test('Vidu testConnection uses the free task-list endpoint and Token authorization', async () => {
  const calls = [];
  const provider = new ViduProvider(config, async (url, options) => {
    calls.push({ url, options });
    return response({ tasks: [] });
  });

  const result = await provider.testConnection();
  assert.equal(result.connected, true);
  assert.equal(result.defaultModel, 'viduq3-turbo');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.vidu.test/ent/v2/tasks');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Token secret');
});

test('Vidu text2video uses the valid default model, submits once, and polls creations', async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return response({ task_id: 'task/one' });
    return response(calls.length === 2 ? { state: 'processing' } : { state: 'success', creations: [{ url: 'https://cdn.test/video.mp4' }] });
  };
  const provider = new ViduProvider(config, transport);
  const result = await provider.execute({ mediaType: 'video', prompt: 'A product reveal', parameters: { aspectRatio: '9:16', duration: 5 } });

  assert.equal(ProviderFactory.defaults('vidu').model, 'viduq3-turbo');
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(calls[0].url, 'https://api.vidu.test/ent/v2/text2video');
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'viduq3-turbo', prompt: 'A product reveal', duration: 5, aspect_ratio: '9:16' });
  assert.equal(calls[1].url, 'https://api.vidu.test/ent/v2/tasks/task%2Fone/creations');
  assert.equal(result.providerJobId, 'task/one');
  assert.deepEqual(result.media, [{ url: 'https://cdn.test/video.mp4' }]);
});

test('Vidu img2video accepts exactly one image URL', async () => {
  const calls = [];
  const provider = new ViduProvider(config, successfulTransport(calls));
  await provider.execute({ mediaType: 'video', prompt: 'Animate it', assets: [{ url: 'https://cdn.test/source.png' }], parameters: {} });

  assert.equal(calls[0].url, 'https://api.vidu.test/ent/v2/img2video');
  assert.deepEqual(JSON.parse(calls[0].options.body).images, ['https://cdn.test/source.png']);
  assert.deepEqual(calls.map(call => call.options.method), ['POST', 'GET']);
});

test('Vidu reference2video accepts two to seven images', async () => {
  const calls = [];
  const provider = new ViduProvider(config, successfulTransport(calls));
  await provider.execute({ mediaType: 'video', prompt: 'Combine references', assets: [{ url: 'https://cdn.test/one.png' }, { url: 'https://cdn.test/two.png' }], parameters: {} });

  assert.equal(calls[0].url, 'https://api.vidu.test/ent/v2/reference2video');
  assert.deepEqual(JSON.parse(calls[0].options.body).images, ['https://cdn.test/one.png', 'https://cdn.test/two.png']);
});

test('Vidu reference2image is selected for image generation', async () => {
  const calls = [];
  const provider = new ViduProvider(config, successfulTransport(calls));
  await provider.execute({ mediaType: 'image', prompt: 'Restyle reference', assets: [{ url: 'https://cdn.test/reference.png' }], parameters: {} });

  assert.equal(calls[0].url, 'https://api.vidu.test/ent/v2/reference2image');
  assert.equal(JSON.parse(calls[0].options.body).model, 'viduq2');
});

test('Vidu reference2image rejects more than seven images before submission', async () => {
  let calls = 0;
  const provider = new ViduProvider(config, async () => { calls += 1; return response({}); });
  const assets = Array.from({ length: 8 }, (_, index) => ({ url: `https://cdn.test/image-${index}.png` }));

  await assert.rejects(provider.execute({ mediaType: 'image', model: 'viduq3-turbo', prompt: 'Too many references', assets, parameters: {} }), /reference2image.*maksimal tujuh/);
  assert.equal(calls, 0);
});

test('Vidu converts Base64 assets to data URLs', async () => {
  const calls = [];
  const provider = new ViduProvider(config, successfulTransport(calls));
  await provider.execute({ mediaType: 'video', prompt: 'Animate Base64', assets: [{ mimeType: 'image/webp', data: 'YWJj' }], parameters: {} });

  assert.equal(calls[0].url, 'https://api.vidu.test/ent/v2/img2video');
  assert.deepEqual(JSON.parse(calls[0].options.body).images, ['data:image/webp;base64,YWJj']);
});

test('Vidu rejects more than seven reference images before submission', async () => {
  const provider = new ViduProvider(config, async () => { throw new Error('transport must not run'); });
  const assets = Array.from({ length: 8 }, (_, index) => ({ url: `https://cdn.test/${index}.png` }));
  await assert.rejects(provider.execute({ mediaType: 'video', prompt: 'Too many', assets, parameters: {} }), /maksimal tujuh gambar/);
});

test('Vidu marks polling GET errors non-retryable and never sends a second POST', async () => {
  const calls = [];
  const provider = new ViduProvider(config, async (url, options) => {
    calls.push({ url, options });
    return options.method === 'POST' ? response({ task_id: 'created-task' }) : response('temporary poll error', { ok: false, status: 503 });
  });

  await assert.rejects(provider.execute({ mediaType: 'video', prompt: 'Generate', parameters: {} }), error => error.nonRetryable === true && error.status === 503 && error.providerRequestId === 'created-task');
  assert.deepEqual(calls.map(call => call.options.method), ['POST', 'GET']);
});

test('Vidu normalizes the legacy vidu2.0 model for text2video', async () => {
  const calls = [];
  const provider = new ViduProvider({ ...config, default_model: 'vidu2.0' }, successfulTransport(calls));
  await provider.execute({ mediaType: 'video', model: 'vidu2.0', prompt: 'Legacy configuration', parameters: {} });

  assert.equal(calls[0].url, 'https://api.vidu.test/ent/v2/text2video');
  assert.equal(JSON.parse(calls[0].options.body).model, 'viduq3-turbo');
});

test('connector does not retry a paid Vidu POST after polling fails', async () => {
  const db = createDatabase(':memory:');
  connector.save(db, 'vidu', { apiKey: 'secret', enabled: true, retry: 2, timeout: 10000 });
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    return options.method === 'POST' ? response({ task_id: 'connector-task' }) : response('poll unavailable', { ok: false, status: 503 });
  };

  let generationId;
  try {
    await connector.execute(db, { provider: 'vidu', mediaType: 'video', prompt: 'Connector retry guard' }, transport);
    assert.fail('connector.execute should reject');
  } catch (error) {
    generationId = error.generationId;
    assert.equal(error.providerRequestId, 'connector-task');
  }

  assert.equal(db.prepare("SELECT retry_count FROM ai_provider_settings WHERE provider='vidu'").get().retry_count, 2);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.deepEqual(calls.map(call => call.options.method), ['POST', 'GET']);
  assert.equal(db.prepare('SELECT provider_request_id FROM ai_generations WHERE id=?').get(generationId).provider_request_id, 'connector-task');
  db.close();
});

test('Vidu rejects success responses without a creation URL', async () => {
  const provider = new ViduProvider(config, async (url, options) => response(options.method === 'POST' ? { task_id: 'empty-task' } : { state: 'success', creations: [{}] }));
  await assert.rejects(provider.execute({ mediaType: 'video', prompt: 'Empty', parameters: {} }), /tanpa URL creation/);
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
