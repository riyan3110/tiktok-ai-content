const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('./config');

function createDatabase(filename = config.databasePath) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(path.join(config.root, 'database/schema.sql'), 'utf8'));
  const columns = new Set(db.prepare('PRAGMA table_info(contents)').all().map(({ name }) => name));
  if (!columns.has('topic_source')) db.exec("ALTER TABLE contents ADD COLUMN topic_source TEXT NOT NULL DEFAULT 'ai'");
  if (!columns.has('requested_topic')) db.exec('ALTER TABLE contents ADD COLUMN requested_topic TEXT');
  if (!columns.has('downloaded_bytes')) db.exec('ALTER TABLE contents ADD COLUMN downloaded_bytes INTEGER');
  if (!columns.has('fail_reason')) db.exec('ALTER TABLE contents ADD COLUMN fail_reason TEXT');
  if (!columns.has('content_category')) db.exec("ALTER TABLE contents ADD COLUMN content_category TEXT NOT NULL DEFAULT 'Iklan & UGC'");
  if (!columns.has('content_format')) db.exec("ALTER TABLE contents ADD COLUMN content_format TEXT NOT NULL DEFAULT 'Tutorial langkah'");
  if (!columns.has('main_topic')) db.exec('ALTER TABLE contents ADD COLUMN main_topic TEXT');
  if (!columns.has('content_angle')) db.exec('ALTER TABLE contents ADD COLUMN content_angle TEXT');
  if (!columns.has('trend_reference_id')) db.exec('ALTER TABLE contents ADD COLUMN trend_reference_id INTEGER REFERENCES trend_reference_sets(id) ON DELETE SET NULL');
  if (!columns.has('trend_keywords_used')) db.exec("ALTER TABLE contents ADD COLUMN trend_keywords_used TEXT NOT NULL DEFAULT '[]'");
  if (!columns.has('trend_keywords_ignored')) db.exec("ALTER TABLE contents ADD COLUMN trend_keywords_ignored TEXT NOT NULL DEFAULT '[]'");
  const trendColumns = new Set(db.prepare('PRAGMA table_info(trend_reference_sets)').all().map(({ name }) => name));
  if (!trendColumns.has('trend_hooks')) db.exec("ALTER TABLE trend_reference_sets ADD COLUMN trend_hooks TEXT NOT NULL DEFAULT '[]'");
  if (!trendColumns.has('trend_content_patterns')) db.exec("ALTER TABLE trend_reference_sets ADD COLUMN trend_content_patterns TEXT NOT NULL DEFAULT '[]'");
  if (!trendColumns.has('keyword_categories')) db.exec("ALTER TABLE trend_reference_sets ADD COLUMN keyword_categories TEXT NOT NULL DEFAULT '[]'");
  return db;
}

module.exports = { createDatabase };
