const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const { deleteOne, deleteAll, ownedImagePath } = require('../src/services/history');

function insert(db, topic, slides) {
  return Number(db.prepare('INSERT INTO contents(topic,hook,body,caption,hashtags,cta,slides) VALUES(?,?,?,?,?,?,?)').run(topic, 'H', 'B', 'C', '[]', 'CTA', JSON.stringify(slides)).lastInsertRowid);
}

test('hapus satu konten menghapus gambarnya tanpa menyentuh gambar konten lain', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'history-images-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const db = createDatabase(':memory:'); t.after(() => db.close());
  const first = insert(db, 'Satu', ['/generated/1-1.jpg', '/generated/1-2.jpg']);
  const second = insert(db, 'Dua', ['/generated/2-1.jpg']);
  await Promise.all(['1-1.jpg', '1-2.jpg', '2-1.jpg'].map((name) => fs.writeFile(path.join(dir, name), name)));
  await deleteOne(db, String(first), dir);
  await assert.rejects(fs.access(path.join(dir, '1-1.jpg')));
  await assert.rejects(fs.access(path.join(dir, '1-2.jpg')));
  await fs.access(path.join(dir, '2-1.jpg'));
  assert.equal(db.prepare('SELECT id FROM contents').get().id, second);
});

test('hapus semua menghapus seluruh file gambar yang tercatat', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'history-all-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const db = createDatabase(':memory:'); t.after(() => db.close());
  insert(db, 'Satu', ['/generated/1-1.jpg']); insert(db, 'Dua', ['/generated/2-1.jpg']);
  await Promise.all(['1-1.jpg', '2-1.jpg'].map((name) => fs.writeFile(path.join(dir, name), name)));
  await deleteAll(db, dir);
  assert.deepEqual(await fs.readdir(dir), []);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM contents').get().count, 0);
});

test('path traversal dan nama file milik ID lain tidak pernah dianggap aman', () => {
  assert.equal(ownedImagePath(1, '/generated/../../etc/passwd'), null);
  assert.equal(ownedImagePath(1, '/generated/2-1.jpg'), null);
  assert.equal(ownedImagePath(1, '/generated/1-1.png'), null);
});
