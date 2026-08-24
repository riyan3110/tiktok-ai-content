const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { install } = require('../src/services/localMediaPreviewPatch');

async function createLocalVideo(app) {
  const payload = Buffer.concat([Buffer.from('00000018667479706d703432', 'hex'), crypto.randomBytes(64)]);
  const uploaded = await request(app).post('/api/assets/upload').send({
    name: `range-${crypto.randomUUID()}.mp4`,
    mimeType: 'video/mp4',
    type: 'video',
    data: payload.toString('base64')
  }).expect(201);
  return { payload, asset: uploaded.body };
}

test('local media preview honors byte ranges without loading the whole file', async () => {
  const db = createDatabase(':memory:');
  db.prepare("UPDATE storage_settings SET provider='local' WHERE id=1").run();
  const app = createApp({ db });
  install({ app, db });

  const { payload, asset } = await createLocalVideo(app);
  try {
    const response = await request(app)
      .get(`/api/assets/${asset.id}/preview`)
      .set('Range', 'bytes=4-11')
      .expect(206);

    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(response.headers['content-range'], `bytes 4-11/${payload.length}`);
    assert.equal(Number(response.headers['content-length']), 8);
    assert.match(response.headers['content-type'], /^video\/mp4/);
    assert.equal(response.headers['cache-control'], 'private, max-age=3600');
    assert.deepEqual(response.body, payload.subarray(4, 12));
  } finally {
    await request(app).delete(`/api/assets/${asset.id}?permanent=true`).expect(200);
    db.close();
  }
});

test('local media preview still supports normal full responses and advertises ranges', async () => {
  const db = createDatabase(':memory:');
  db.prepare("UPDATE storage_settings SET provider='local' WHERE id=1").run();
  const app = createApp({ db });
  install({ app, db });

  const { payload, asset } = await createLocalVideo(app);
  try {
    const response = await request(app)
      .get(`/api/assets/${asset.id}/preview`)
      .expect(200);

    assert.equal(response.headers['accept-ranges'], 'bytes');
    assert.equal(Number(response.headers['content-length']), payload.length);
    assert.deepEqual(response.body, payload);
  } finally {
    await request(app).delete(`/api/assets/${asset.id}?permanent=true`).expect(200);
    db.close();
  }
});
