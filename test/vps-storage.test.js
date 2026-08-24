const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createDatabase } = require('../src/db');
const {
  GENERATED_MEDIA_TTL_MS,
  TEXT_CONTENT_TTL_MS,
  useVpsLocalStorage,
  cleanupGeneratedAssets,
  cleanupTextContentSlides,
  migrateTencentCosToLocal
} = require('../src/storage/vpsStorage');

function insertAsset(db, { id, provider = 'local', generated = 1, createdAt }) {
  db.prepare(`INSERT INTO assets(id,name,type,mime_type,storage_provider,storage_key,storage_url,size,checksum,tags,metadata,is_generated,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, `${id}.jpg`, 'image', 'image/jpeg', provider, `${id}.jpg`, `/asset-files/${id}.jpg`, 3,
    crypto.createHash('sha256').update('abc').digest('hex'), '[]', '{}', generated, createdAt
  );
}

function insertContent(db, { topic, slides, status = 'generated', createdAt, updatedAt }) {
  db.prepare(`INSERT INTO contents(topic,topic_source,hook,body,caption,hashtags,cta,slides,publish_status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(topic, 'manual', 'hook', 'body', 'caption', '[]', '', JSON.stringify(slides), status, createdAt);
  if (updatedAt) db.prepare('UPDATE contents SET updated_at=? WHERE topic=?').run(updatedAt, topic);
}

test('generated VPS media expires after 24 hours while manual and COS assets stay untouched', async () => {
  const db = createDatabase(':memory:');
  const now = Date.parse('2026-08-24T12:00:00Z');
  insertAsset(db, { id: 'old-generated', createdAt: '2026-08-23 11:59:00' });
  insertAsset(db, { id: 'fresh-generated', createdAt: '2026-08-24 11:00:00' });
  insertAsset(db, { id: 'manual-local', generated: 0, createdAt: '2026-08-20 00:00:00' });
  insertAsset(db, { id: 'old-cos', provider: 'tencent-cos', createdAt: '2026-08-20 00:00:00' });
  const deleted = [];
  const storage = { delete: async id => { deleted.push(id); return true; } };
  const result = await cleanupGeneratedAssets({ db, storage, now });
  assert.equal(GENERATED_MEDIA_TTL_MS, 24 * 60 * 60 * 1000);
  assert.deepEqual(deleted, ['old-generated']);
  assert.equal(result.deleted, 1);
  db.close();
});

test('Text Content keeps TikTok inbox handoff slides for five hours and protects active transfers', async () => {
  const db = createDatabase(':memory:');
  const now = Date.parse('2026-08-24T12:00:00Z');
  insertContent(db, { topic: 'expired', slides: ['/generated/1.jpg'], createdAt: '2026-08-24 06:59:00' });
  insertContent(db, { topic: 'active', slides: ['/generated/2.jpg'], status: 'PROCESSING_UPLOAD', createdAt: '2026-08-24 06:00:00' });
  insertContent(db, { topic: 'fresh', slides: ['/generated/3.jpg'], createdAt: '2026-08-24 11:00:00' });
  insertContent(db, { topic: 'completed', slides: ['/generated/4.jpg'], status: 'PUBLISH_COMPLETE', createdAt: '2026-08-24 11:59:00' });
  insertContent(db, { topic: 'handoff-fresh', slides: ['/generated/5.jpg'], status: 'SEND_TO_USER_INBOX', createdAt: '2026-08-24 01:00:00', updatedAt: '2026-08-24 11:30:00' });
  insertContent(db, { topic: 'handoff-expired', slides: ['/generated/6.jpg'], status: 'SEND_TO_USER_INBOX', createdAt: '2026-08-24 01:00:00', updatedAt: '2026-08-24 06:59:00' });
  insertContent(db, { topic: 'cancel-pending', slides: ['/generated/7.jpg'], status: 'CANCEL_REQUESTED', createdAt: '2026-08-24 01:00:00', updatedAt: '2026-08-24 11:40:00' });

  const removed = [];
  const images = { cleanupSlides: async slides => removed.push(...slides) };
  const result = await cleanupTextContentSlides({ db, images, now });

  assert.equal(TEXT_CONTENT_TTL_MS, 5 * 60 * 60 * 1000);
  assert.deepEqual(removed.sort(), ['/generated/1.jpg', '/generated/4.jpg', '/generated/6.jpg']);
  assert.equal(result.deletedContents, 3);
  assert.equal(db.prepare("SELECT slides FROM contents WHERE topic='active'").get().slides, '["/generated/2.jpg"]');
  assert.equal(db.prepare("SELECT slides FROM contents WHERE topic='handoff-fresh'").get().slides, '["/generated/5.jpg"]');
  assert.equal(db.prepare("SELECT slides FROM contents WHERE topic='cancel-pending'").get().slides, '["/generated/7.jpg"]');
  assert.equal(db.prepare("SELECT slides FROM contents WHERE topic='handoff-expired'").get().slides, '[]');
  assert.equal(db.prepare("SELECT slides FROM contents WHERE topic='expired'").get().slides, '[]');
  db.close();
});

test('COS migration verifies bytes, rewrites asset to local, deletes source, and leaves provider local', async () => {
  const db = createDatabase(':memory:');
  db.prepare("UPDATE storage_settings SET provider='tencent-cos',secret_id_encrypted='id',secret_key_encrypted='key',bucket='bucket',region='ap-singapore' WHERE id=1").run();
  const data = Buffer.from('abc');
  const asset = {
    id: 'cos-1', name: 'cos-1.jpg', mime_type: 'image/jpeg', storage_key: '2026/cos-1.jpg',
    checksum: crypto.createHash('sha256').update(data).digest('hex'), metadata: {}, storage_provider: 'tencent-cos'
  };
  const updates = [];
  const sourceDeletes = [];
  const source = {
    download: async () => ({ data, contentType: 'image/jpeg' }),
    delete: async key => { sourceDeletes.push(key); }
  };
  const target = {
    upload: async key => ({ key, url: `/asset-files/${key}` }),
    delete: async () => {}
  };
  const storage = {
    row: () => db.prepare('SELECT * FROM storage_settings WHERE id=1').get(),
    repository: {
      list: query => query.trash === 'true' ? [] : [asset],
      update: (id, patch) => { updates.push({ id, patch }); return { ...asset, ...patch }; }
    },
    adapter: provider => { assert.equal(provider, 'tencent-cos'); return source; },
    local: () => target
  };
  const result = await migrateTencentCosToLocal({ db, storage, deleteSource: true });
  assert.equal(result.migrated, 1);
  assert.equal(result.sourceDeleted, 1);
  assert.equal(updates[0].patch.storageProvider, 'local');
  assert.deepEqual(sourceDeletes, ['2026/cos-1.jpg']);
  assert.equal(useVpsLocalStorage(db).provider, 'local');
  db.close();
});
