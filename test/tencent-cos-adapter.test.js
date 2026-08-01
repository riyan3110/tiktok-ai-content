const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { TencentCosAdapter } = require('../src/storage/adapters');

const options = {
  secretId: 'AKIDEXAMPLE',
  secretKey: 'SECRETEXAMPLE',
  bucket: 'aiadslab-assets-1449781335',
  region: 'ap-singapore',
  useHttps: true
};

test('Tencent COS builds the official Singapore bucket endpoint and canonical URL', () => {
  const adapter = new TencentCosAdapter(options);
  assert.equal(adapter.host(), 'aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com');
  assert.equal(adapter.url('folder/a b+(1).jpg', 'z=last&max-keys=0'), 'https://aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com/folder/a%20b%2B%281%29.jpg?max-keys=0&z=last');

  const custom = new TencentCosAdapter({ ...options, endpoint: 'https://AIADSLAB-ASSETS-1449781335.cos.ap-singapore.myqcloud.com/' });
  assert.equal(custom.host(), 'aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com');

  const regional = new TencentCosAdapter({ ...options, endpoint: 'cos.ap-singapore.myqcloud.com' });
  assert.equal(regional.host(), 'aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com');
  assert.equal(regional.url('folder/a b.jpg'), 'https://aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com/folder/a%20b.jpg');
  assert.equal(regional.publicUrl('folder/a b.jpg'), 'https://aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com/folder/a%20b.jpg');
});

test('Tencent COS PUT uses the bucket host and object-only canonical path with a regional endpoint', async t => {
  t.mock.method(Date, 'now', () => 1_700_000_000_000);
  let request;
  const adapter = new TencentCosAdapter({ ...options, endpoint: 'cos.ap-singapore.myqcloud.com' }, async (url, init) => {
    request = { url, init };
    return { ok: true, status: 200, headers: new Headers() };
  });

  const uploaded = await adapter.upload('uploads/my image.png', Buffer.from('image'), { mimeType: 'image/png' });

  assert.equal(request.url, 'https://aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com/uploads/my%20image.png');
  assert.equal(request.init.method, 'PUT');
  assert.equal(request.init.headers.Host, 'aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com');
  assert.equal(request.init.headers['Content-Type'], 'image/png');
  assert.equal(uploaded.url, request.url);
  assert.match(request.init.headers.Authorization, /q-header-list=host/);
});

test('Tencent COS signed URLs use the encoded object URL on the bucket host', async t => {
  t.mock.method(Date, 'now', () => 1_700_000_000_000);
  const adapter = new TencentCosAdapter({ ...options, endpoint: 'https://cos.ap-singapore.myqcloud.com' });
  const signed = await adapter.signedUrl('uploads/my image.png', 600);
  const url = new URL(signed);

  assert.equal(url.origin, 'https://aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com');
  assert.equal(url.pathname, '/uploads/my%20image.png');
  assert.equal(url.searchParams.get('q-ak'), options.secretId);
  assert.equal(url.searchParams.get('q-sign-time'), '1699999940;1700000600');
});

test('Tencent COS authorization signs the canonical URI, query, and host', t => {
  t.mock.method(Date, 'now', () => 1_700_000_000_000);
  const adapter = new TencentCosAdapter(options);
  const authorization = adapter.authorization('GET', 'folder/a b.jpg', 'z=last&max-keys=0');
  const period = '1699999940;1700003600';
  const canonical = 'get\n/folder/a%20b.jpg\nmax-keys=0&z=last\nhost=aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com\n';
  const signKey = crypto.createHmac('sha1', options.secretKey).update(period).digest('hex');
  const stringToSign = `sha1\n${period}\n${crypto.createHash('sha1').update(canonical).digest('hex')}\n`;
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  assert.equal(authorization, `q-sign-algorithm=sha1&q-ak=AKIDEXAMPLE&q-sign-time=${period}&q-key-time=${period}&q-header-list=host&q-url-param-list=max-keys;z&q-signature=${signature}`);
  assert.equal(authorization.includes('TC3-HMAC-SHA256'), false);
});

test('Tencent COS connection test sends an authenticated bucket-list request', async t => {
  t.mock.method(Date, 'now', () => 1_700_000_000_000);
  let request;
  const adapter = new TencentCosAdapter(options, async (url, init) => {
    request = { url, init };
    return { ok: true, status: 200, headers: new Headers() };
  });
  const result = await adapter.test();
  assert.equal(request.url, 'https://aiadslab-assets-1449781335.cos.ap-singapore.myqcloud.com/?max-keys=0');
  assert.equal(request.init.headers.Host, adapter.host());
  assert.match(request.init.headers.Authorization, /q-url-param-list=max-keys/);
  assert.equal(result.connected, true);
});
