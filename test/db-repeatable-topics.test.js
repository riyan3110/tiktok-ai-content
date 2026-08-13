const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const config = require('../src/config');
const { createDatabase } = require('../src/db');

test('database lama dimigrasikan agar topik manual dapat diulang tanpa kehilangan data', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repeatable-topics-'));
  const filename = path.join(directory, 'legacy.db');
  let db;

  try {
    const currentSchema = fs.readFileSync(path.join(config.root, 'database/schema.sql'), 'utf8');
    const legacySchema = currentSchema.replace('topic TEXT NOT NULL,', 'topic TEXT NOT NULL UNIQUE,');
    assert.notEqual(legacySchema, currentSchema);

    const legacy = new Database(filename);
    legacy.pragma('foreign_keys = ON');
    legacy.exec(legacySchema);
    const old = legacy.prepare("INSERT INTO contents(topic,topic_source,requested_topic,hook,body,caption,hashtags,cta) VALUES(?,?,?,?,?,?,?,?)")
      .run('Cloude menerapkan watermark', 'manual', 'Cloude menerapkan watermark', 'Hook lama', 'Isi lama', 'Caption lama', '[]', 'CTA');
    legacy.exec('CREATE TABLE content_links (id INTEGER PRIMARY KEY, content_id INTEGER REFERENCES contents(id))');
    legacy.prepare('INSERT INTO content_links(content_id) VALUES(?)').run(old.lastInsertRowid);
    legacy.close();

    db = createDatabase(filename);
    const repeated = db.prepare("INSERT INTO contents(topic,topic_source,requested_topic,hook,body,caption,hashtags,cta) VALUES(?,?,?,?,?,?,?,?)")
      .run('Cloude menerapkan watermark', 'manual', 'Cloude menerapkan watermark', 'Hook baru', 'Isi baru', 'Caption baru', '[]', 'CTA');

    assert.ok(repeated.lastInsertRowid > old.lastInsertRowid);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM contents WHERE topic='Cloude menerapkan watermark'").get().count, 2);
    assert.equal(db.prepare('SELECT content_id FROM content_links').get().content_id, old.lastInsertRowid);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const indexes = db.prepare('PRAGMA index_list(contents)').all();
    assert.equal(indexes.some(index => index.unique === 1 && index.partial === 0), false);
    assert.equal(indexes.some(index => index.name === 'idx_contents_generated_topic' && index.unique === 1 && index.partial === 1), true);
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
