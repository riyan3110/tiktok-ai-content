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
