const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

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
  const transport = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
  };
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
  assert.match(uploaded.body.storage_key, /^\d{4}-\d{2}-\d{2}\/[\w-]+\.png$/);
  const uploadedUrl = new URL(uploaded.body.storage_url);
  assert.equal(uploadedUrl.origin, 'https://asset-bucket-123.cos.ap-singapore.myqcloud.com');
  assert.equal(uploadedUrl.pathname, `/${uploaded.body.storage_key}`);
  assert.equal(uploadedUrl.searchParams.get('q-ak'), 'AKIDEXAMPLE');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].url, `https://asset-bucket-123.cos.ap-singapore.myqcloud.com/${uploaded.body.storage_key}`);
  assert.deepEqual(Buffer.from(calls[0].init.body), Buffer.from('cos-content'));

  const listed = await request(app).get('/api/assets?provider=tencent-cos').expect(200);
  assert.equal(listed.body[0].url, listed.body[0].storage_url);
  assert.equal(new URL(listed.body[0].url).searchParams.get('q-sign-algorithm'), 'sha1');
  assert.notEqual(db.prepare('SELECT storage_url FROM assets WHERE id=?').get(uploaded.body.id).storage_url, uploaded.body.storage_url);
  db.close();
});

test('Asset Manager refreshes signed COS GET URLs without issuing a download request', async () => {
  const calls = [];
  const db = createDatabase(':memory:');
  const app = createApp({ db, storageTransport: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
  } });
  await request(app).put('/api/storage/settings').send({ provider: 'tencent-cos', secretId: 'id', secretKey: 'key', bucket: 'private-123', region: 'ap-singapore', signedUrlExpiration: 900 }).expect(200);
  const uploaded = await request(app).post('/api/assets/upload').send({ name: 'preview.jpg', mimeType: 'image/jpeg', data: Buffer.from('image').toString('base64') }).expect(201);

  const asset = await request(app).get(`/api/assets/${uploaded.body.id}`).expect(200);
  const url = new URL(asset.body.url);
  const [starts, expires] = url.searchParams.get('q-sign-time').split(';').map(Number);
  assert.equal(expires - starts, 960);
  assert.equal(url.searchParams.get('q-ak'), 'id');
  assert.equal(asset.body.storage_url, asset.body.url);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'PUT');
  db.close();
});

test('Tencent COS upload errors do not silently fall back to local storage', async () => {
  const db = createDatabase(':memory:');
  const app = createApp({ db, storageTransport: async () => ({ ok: false, status: 403, headers: new Headers(), text: async () => 'AccessDenied' }) });
  await request(app).put('/api/storage/settings').send({ provider: 'tencent-cos', secretId: 'id', secretKey: 'key', bucket: 'bucket-123', region: 'ap-singapore' }).expect(200);
  await request(app).post('/api/assets/upload').send({ name: 'blocked.txt', mimeType: 'text/plain', data: Buffer.from('blocked').toString('base64') }).expect(403);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM assets').get().count, 0);
  db.close();
});
