const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviderTransport, endpointVariants } = require('../src/services/providerTransportCompatibility');

test('adds common v1 prefixes when Base URL is a provider root', () => {
  assert.deepEqual(endpointVariants('https://api.example.com/models'), [
    'https://api.example.com/models',
    'https://api.example.com/v1/models',
    'https://api.example.com/api/v1/models'
  ]);
});

test('does not duplicate v1 when Base URL already includes it', () => {
  assert.deepEqual(endpointVariants('https://api.example.com/v1/images/generations'), [
    'https://api.example.com/v1/images/generations'
  ]);
});

test('credential verification always reaches the upstream provider', async () => {
  let calls = 0;
  const transport = createProviderTransport(async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: [{ id: 'image-model' }] }), { status: 200 });
  });
  const response = await transport('https://api.example.com/v1/models', {
    headers: { Authorization: 'Bearer invalid-test-value' }
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('falls back from root endpoint to /v1 and preserves Bearer auth', async () => {
  const calls = [];
  const transport = createProviderTransport(async (url, init) => {
    calls.push({ url: String(url), auth: new Headers(init.headers).get('authorization') });
    if (String(url).endsWith('/v1/images/generations')) {
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.com/image.png' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'missing' }), { status: 404 });
  });
  const response = await transport('https://api.example.com/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'image-model', prompt: 'test' })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(item => item.url), [
    'https://api.example.com/images/generations',
    'https://api.example.com/v1/images/generations'
  ]);
  assert.ok(calls.every(item => item.auth === 'Bearer secret'));
});

test('falls back to x-api-key when provider rejects Bearer auth', async () => {
  const seen = [];
  const transport = createProviderTransport(async (url, init) => {
    const headers = new Headers(init.headers);
    seen.push({ bearer: headers.get('authorization'), apiKey: headers.get('x-api-key') });
    if (headers.get('x-api-key') === 'secret') return new Response('{}', { status: 200 });
    return new Response('{}', { status: 401 });
  });
  const response = await transport('https://api.example.com/v1/models', {
    headers: { Authorization: 'Bearer secret' }
  });
  assert.equal(response.status, 200);
  assert.equal(seen[0].bearer, 'Bearer secret');
  assert.equal(seen[1].apiKey, 'secret');
});
