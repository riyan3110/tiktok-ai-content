const test = require('node:test');
const assert = require('node:assert/strict');
const NanoBananaProvider = require('../src/providers/NanoBananaProvider');
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

const providerConfig = {
  provider: 'nanobanana',
  base_url: 'https://api.nanobanana.test',
  api_key: 'secret',
  default_model: 'nanobanana',
  poll_interval_ms: 1,
  poll_retry_backoff_ms: 1
};

test('NanoBanana is registered as an image provider with production defaults', () => {
  assert.equal(ProviderFactory.defaults('nanobanana').baseUrl, 'https://api.nanobananaapi.ai');
  assert.equal(ProviderFactory.defaults('nanobanana').model, 'nanobanana');
  assert.deepEqual(connector.CAPABILITIES.nanobanana, ['image']);

  const db = createDatabase(':memory:');
  const row = connector.setting(db, 'nanobanana');
  assert.equal(row.timeout_ms, 300000);
  db.close();
});

test('NanoBanana Test Connection uses the non-consuming credit endpoint', async () => {
  const calls = [];
  const provider = new NanoBananaProvider(providerConfig, async (url, options) => {
    calls.push({ url, options });
    return response({ code: 200, msg: 'success', data: 50 });
  });

  const result = await provider.testConnection();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.nanobanana.test/api/v1/common/credit');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  assert.equal(result.quotaStatus, '50 credits');
});

test('NanoBanana text-to-image submits once and polls record-info', async () => {
  const calls = [];
  let polls = 0;
  const provider = new NanoBananaProvider(providerConfig, async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return response({ code: 200, msg: 'success', data: { taskId: 'task-one' } });
    polls += 1;
    return response({
      code: 200,
      msg: 'success',
      data: polls === 1
        ? { taskId: 'task-one', successFlag: 0 }
        : { taskId: 'task-one', successFlag: 1, response: { resultImageUrl: 'https://cdn.test/result.jpg' } }
    });
  });

  const result = await provider.execute({ mediaType: 'image', prompt: 'Create ad', assets: [], parameters: { aspectRatio: '9:16' } });
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(calls[0].url, 'https://api.nanobanana.test/api/v1/nanobanana/generate');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.prompt, 'Create ad');
  assert.equal(body.numImages, 1);
  assert.equal(body.type, 'TEXTTOIAMGE');
  assert.equal(body.image_size, '9:16');
  assert.match(body.callBackUrl, /\/api\/ai\/providers\/nanobanana\/callback$/);
  assert.equal(calls[1].url, 'https://api.nanobanana.test/api/v1/nanobanana/record-info?taskId=task-one');
  assert.equal(result.providerJobId, 'task-one');
  assert.deepEqual(result.media, [{ url: 'https://cdn.test/result.jpg' }]);
});

test('NanoBanana image edit forwards reference URLs', async () => {
  const calls = [];
  const provider = new NanoBananaProvider(providerConfig, async (url, options) => {
    calls.push({ url, options });
    return options.method === 'POST'
      ? response({ code: 200, msg: 'success', data: { taskId: 'edit-one' } })
      : response({ code: 200, msg: 'success', data: { taskId: 'edit-one', successFlag: 1, response: { resultImageUrl: 'https://cdn.test/edited.jpg' } } });
  });

  await provider.execute({ mediaType: 'image', prompt: 'Edit', assets: [{ url: 'https://cdn.test/input.png' }], parameters: { aspectRatio: '1:1' } });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.type, 'IMAGETOIAMGE');
  assert.deepEqual(body.imageUrls, ['https://cdn.test/input.png']);
});

test('connector never submits a second paid NanoBanana task after polling fails', async () => {
  const db = createDatabase(':memory:');
  connector.save(db, 'nanobanana', { apiKey: 'secret', enabled: true, retry: 2, timeout: 10000 });
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') return response({ code: 200, msg: 'success', data: { taskId: 'paid-task' } });
    return response({ code: 500, msg: 'temporary poll error' }, { ok: false, status: 500 });
  };

  try {
    await connector.execute(db, { provider: 'nanobanana', mediaType: 'image', prompt: 'No duplicate' }, transport);
    assert.fail('connector.execute should reject');
  } catch (error) {
    assert.equal(error.providerRequestId, 'paid-task');
  }

  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  db.close();
});
