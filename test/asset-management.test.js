const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

function verifiedCosTransport(calls, getResponse) {
  const uploadedHeaders = new Map();
  return async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'PUT') uploadedHeaders.set(url, init.headers);
    if (init.method === 'HEAD') {
      const headers = uploadedHeaders.get(url);
      return { ok: true, status: 200, headers: new Headers({ 'content-type': headers['Content-Type'], 'content-disposition': headers['Content-Disposition'], 'x-cos-request-id': 'metadata-verified' }), text: async () => '' };
    }
    if (init.method === 'GET' && getResponse) return getResponse(url, init);
    return { ok: true, status: 200, headers: new Headers({ 'x-cos-request-id': 'upload-complete' }), text: async () => '' };
  };
}

test('asset upload uses backend storage, checksum duplicate detection, and safe public settings', async () => {
  const db = createDatabase(':memory:'); const app = createApp({ db });
  const settings = await request(app).put('/api/storage/settings').send({ provider: 'local', secretId: 'secret-id', secretKey: 'secret-key' }).expect(200);
  assert.equal(settings.body.secretKey, '••••••••'); assert.equal(JSON.stringify(settings.body).includes('secret-key'), false);
  const payload = { name: 'reference.txt', mimeType: 'text/plain', data: Buffer.from('asset-content').toString('base64'), tags: ['Character'] };
  const first = await request(app).post('/api/assets/upload').send(payload).expect(201);
  assert.equal(first.body.storage_provider, 'local'); assert.equal(first.body.tags[0], 'Character');
  const duplicate = await request(app).post('/api/assets/upload').send(payload).expect(201);
  assert.equal(duplicate.body.id, first.body.id); assert.equal(duplicate.body.duplicate, true);
  const listed = await request(app).get('/api/assets?keyword=reference&type=prompt-attachment').expect(200);
  assert.equal(listed.body.length, 1); db.close();
});

test('asset folders, favorite, trash, and restore preserve lifecycle', async () => {
  const db = createDatabase(':memory:'); const app = createApp({ db });
  const folder = await request(app).post('/api/asset-folders').send({ name: 'Campaign' }).expect(201);
  const uploaded = await request(app).post('/api/assets/upload').send({ name: 'hero.png', mimeType: 'image/png', data: Buffer.from('png').toString('base64'), folderId: folder.body.id }).expect(201);
  await request(app).patch(`/api/assets/${uploaded.body.id}`).send({ favorite: true, tags: ['Campaign', 'Product'] }).expect(200);
  const favorites = await request(app).get('/api/assets?favorite=true').expect(200); assert.equal(favorites.body.length, 1);
  await request(app).delete(`/api/assets/${uploaded.body.id}`).expect(200);
  assert.equal((await request(app).get('/api/assets?trash=true')).body.length, 1);
  await request(app).post(`/api/assets/${uploaded.body.id}/restore`).expect(200);
  assert.equal((await request(app).get('/api/assets')).body.length, 1); db.close();
});

test('Tencent COS uploads stay in COS and persist the returned key and URL', async () => {
  const calls = [];
  const transport = verifiedCosTransport(calls);
  const db = createDatabase(':memory:');
  const app = createApp({ db, storageTransport: transport });
  await request(app).put('/api/storage/settings').send({
    provider: 'tencent-cos', secretId: 'AKIDEXAMPLE', secretKey: 'SECRETEXAMPLE',
    bucket: 'asset-bucket-123', region: 'ap-singapore', useHttps: true,
    publicUrl: 'https://cdn.example.com/assets', duplicateDetection: true
  }).expect(200);

  const payload = { name: 'cos-image.png', mimeType: 'image/png', data: Buffer.from('cos-content').toString('base64') };
  const uploaded = await request(app).post('/api/assets/upload').send(payload).expect(201);
  assert.equal(uploaded.body.storage_provider, 'tencent-cos');
  assert.match(uploaded.body.storage_key, /^\d{4}-\d{2}-\d{2}\/[\w-]+\/cos-image\.png$/);
  const uploadedUrl = new URL(uploaded.body.storage_url);
  assert.equal(uploadedUrl.origin, 'https://asset-bucket-123.cos.ap-singapore.myqcloud.com');
  assert.equal(uploadedUrl.pathname, `/${uploaded.body.storage_key}`);
  assert.equal(uploadedUrl.searchParams.get('q-ak'), 'AKIDEXAMPLE');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].url, `https://asset-bucket-123.cos.ap-singapore.myqcloud.com/${uploaded.body.storage_key}`);
  assert.deepEqual(Buffer.from(calls[0].init.body), Buffer.from('cos-content'));

  const listed = await request(app).get('/api/assets?provider=tencent-cos').expect(200);
  assert.equal(listed.body[0].url, listed.body[0].storage_url);
  assert.equal(new URL(listed.body[0].url).searchParams.get('q-sign-algorithm'), 'sha1');
  assert.notEqual(db.prepare('SELECT storage_url FROM assets WHERE id=?').get(uploaded.body.id).storage_url, uploaded.body.storage_url);
  db.close();
});

test('Asset Manager returns a signed copy URL and a same-origin preview endpoint without downloading during listing', async () => {
  const calls = [];
  const db = createDatabase(':memory:');
  const app = createApp({ db, storageTransport: verifiedCosTransport(calls) });
  await request(app).put('/api/storage/settings').send({ provider: 'tencent-cos', secretId: 'id', secretKey: 'key', bucket: 'private-123', region: 'ap-singapore', signedUrlExpiration: 900 }).expect(200);
  const uploaded = await request(app).post('/api/assets/upload').send({ name: 'preview.jpg', mimeType: 'image/jpeg', data: Buffer.from('image').toString('base64') }).expect(201);

  const asset = await request(app).get(`/api/assets/${uploaded.body.id}`).expect(200);
  const url = new URL(asset.body.url);
  const [starts, expires] = url.searchParams.get('q-sign-time').split(';').map(Number);
  assert.equal(expires - starts, 960);
  assert.equal(url.searchParams.get('q-ak'), 'id');
  assert.equal(asset.body.storage_url, asset.body.url);
  assert.equal(asset.body.preview_url, `/api/assets/${uploaded.body.id}/preview`);
  assert.notEqual(asset.body.preview_url, asset.body.url);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'PUT');
  db.close();
});

test('Asset Manager loads image previews from the same-origin endpoint and preserves signed Copy URLs', () => {
  const source = require('node:fs').readFileSync(require.resolve('../public/assets.js'), 'utf8');
  assert.match(source, /src="\$\{safe\(asset\.preview_url\)\}"/);
  assert.doesNotMatch(source, /asset\.preview_url \|\| asset\.url/);
  assert.doesNotMatch(source, /createObjectURL|response\.blob/);
  assert.match(source, /writeText\(item\.url\)/);
});

test('COS preview downloads the existing object once and serves an inline image blob', async () => {
  const calls = [];
  const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
  const db = createDatabase(':memory:');
  const app = createApp({ db, storageTransport: verifiedCosTransport(calls, async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg', 'content-disposition': 'inline' }), arrayBuffer: async () => jpeg })) });
  await request(app).put('/api/storage/settings').send({ provider: 'tencent-cos', secretId: 'id', secretKey: 'key', bucket: 'private-123', region: 'ap-singapore' }).expect(200);
  const uploaded = await request(app).post('/api/assets/upload').send({ name: 'legacy.jpg', mimeType: 'application/octet-stream', data: jpeg.toString('base64') }).expect(201);
  assert.equal(uploaded.body.mime_type, 'image/jpeg');
  await request(app).get(`/api/assets/${uploaded.body.id}`).expect(200);
  const preview = await request(app).get(`/api/assets/${uploaded.body.id}/preview`).expect('Content-Type', /image\/jpeg/).expect('Content-Disposition', 'inline').expect(200);
  assert.deepEqual(preview.body, jpeg);
  assert.deepEqual(calls.map(call => call.init.method), ['PUT', 'HEAD', 'GET']);
});

test('concurrent duplicate uploads produce one COS PUT and Copy URL performs no storage operation', async () => {
  const calls = [];
  const db = createDatabase(':memory:');
  const baseTransport = verifiedCosTransport(calls);
  const app = createApp({ db, storageTransport: async (...args) => { await new Promise(resolve => setTimeout(resolve, 10)); return baseTransport(...args); } });
  await request(app).put('/api/storage/settings').send({ provider: 'tencent-cos', secretId: 'id', secretKey: 'key', bucket: 'private-123', region: 'ap-singapore', duplicateDetection: true }).expect(200);
  const payload = { name: 'same.png', mimeType: '', data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
  const [first, second] = await Promise.all([request(app).post('/api/assets/upload').send(payload), request(app).post('/api/assets/upload').send(payload)]);
  assert.equal(first.status, 201); assert.equal(second.status, 201);
  assert.equal(first.body.id, second.body.id);
  assert.equal(second.body.duplicate, true);
  assert.equal(calls.filter(call => call.init.method === 'PUT').length, 1);
  await request(app).get(`/api/assets/${first.body.id}`).expect(200);
  assert.equal(calls.length, 2);
  db.close();
});

test('Local Storage preview remains readable through the blob endpoint', async () => {
  const db = createDatabase(':memory:'); const app = createApp({ db });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const uploaded = await request(app).post('/api/assets/upload').send({ name: 'local.bin', mimeType: '', data: png.toString('base64') }).expect(201);
  assert.equal(uploaded.body.storage_provider, 'local'); assert.equal(uploaded.body.mime_type, 'image/png');
  const preview = await request(app).get(uploaded.body.preview_url).expect('Content-Type', /image\/png/).expect(200);
  assert.deepEqual(preview.body, png); db.close();
});

test('Tencent COS upload errors do not silently fall back to local storage', async () => {
  const db = createDatabase(':memory:');
  const app = createApp({ db, storageTransport: async () => ({ ok: false, status: 403, headers: new Headers(), text: async () => 'AccessDenied' }) });
  await request(app).put('/api/storage/settings').send({ provider: 'tencent-cos', secretId: 'id', secretKey: 'key', bucket: 'bucket-123', region: 'ap-singapore' }).expect(200);
  await request(app).post('/api/assets/upload').send({ name: 'blocked.txt', mimeType: 'text/plain', data: Buffer.from('blocked').toString('base64') }).expect(403);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM assets').get().count, 0);
  db.close();
});

test('asset ID resolver preserves order and resolves Local Storage without client URLs', async () => {
  const db = createDatabase(':memory:'); const app = createApp({ db });
  const first = await request(app).post('/api/assets/upload').send({ name: 'character.png', mimeType: 'image/png', data: Buffer.from('first-image').toString('base64'), tags: ['Character'], metadata: { category: 'Character' } }).expect(201);
  const second = await request(app).post('/api/assets/upload').send({ name: 'logo.png', mimeType: 'image/png', data: Buffer.from('second-image').toString('base64'), tags: ['Logo'], metadata: { category: 'Logo' } }).expect(201);
  const resolved = await request(app).post('/api/assets/resolve').send({ assetIds: [second.body.id, first.body.id] }).expect(200);
  assert.deepEqual(resolved.body.map(asset => asset.id), [second.body.id, first.body.id]);
  assert.ok(resolved.body.every(asset => asset.storage_provider === 'local' && asset.url && asset.preview_url));
  await request(app).post('/api/assets/resolve').send({ assetIds: ['missing'] }).expect(404);
  db.close();
});
