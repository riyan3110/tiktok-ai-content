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
  const templateColumns = new Set(db.prepare('PRAGMA table_info(templates)').all().map(({ name }) => name));
  if (!templateColumns.has('platform')) db.exec('ALTER TABLE templates ADD COLUMN platform TEXT');
  const oauthColumns = new Set(db.prepare('PRAGMA table_info(oauth_states)').all().map(({ name }) => name));
  if (!oauthColumns.has('redirect_uri')) db.exec('ALTER TABLE oauth_states ADD COLUMN redirect_uri TEXT');
  const tokenColumns = new Set(db.prepare('PRAGMA table_info(oauth_tokens)').all().map(({ name }) => name));
  if (!tokenColumns.has('display_name')) db.exec('ALTER TABLE oauth_tokens ADD COLUMN display_name TEXT');
  const columns = new Set(db.prepare('PRAGMA table_info(contents)').all().map(({ name }) => name));
  if (!columns.has('topic_source')) db.exec("ALTER TABLE contents ADD COLUMN topic_source TEXT NOT NULL DEFAULT 'ai'");
  if (!columns.has('requested_topic')) db.exec('ALTER TABLE contents ADD COLUMN requested_topic TEXT');
  if (!columns.has('downloaded_bytes')) db.exec('ALTER TABLE contents ADD COLUMN downloaded_bytes INTEGER');
  if (!columns.has('fail_reason')) db.exec('ALTER TABLE contents ADD COLUMN fail_reason TEXT');
  if (!columns.has('content_category')) db.exec("ALTER TABLE contents ADD COLUMN content_category TEXT NOT NULL DEFAULT 'Iklan & UGC'");
  if (!columns.has('content_format')) db.exec("ALTER TABLE contents ADD COLUMN content_format TEXT NOT NULL DEFAULT 'Tutorial langkah'");
  if (!columns.has('main_topic')) db.exec('ALTER TABLE contents ADD COLUMN main_topic TEXT');
  if (!columns.has('content_angle')) db.exec('ALTER TABLE contents ADD COLUMN content_angle TEXT');
  if (!columns.has('primary_tool')) db.exec('ALTER TABLE contents ADD COLUMN primary_tool TEXT');
  if (!columns.has('hook_pattern')) db.exec('ALTER TABLE contents ADD COLUMN hook_pattern TEXT');
  if (!columns.has('similarity_score')) db.exec('ALTER TABLE contents ADD COLUMN similarity_score REAL NOT NULL DEFAULT 0');
  if (!columns.has('trend_reference_id')) db.exec('ALTER TABLE contents ADD COLUMN trend_reference_id INTEGER REFERENCES trend_reference_sets(id) ON DELETE SET NULL');
  if (!columns.has('trend_keywords_used')) db.exec("ALTER TABLE contents ADD COLUMN trend_keywords_used TEXT NOT NULL DEFAULT '[]'");
  if (!columns.has('trend_keywords_ignored')) db.exec("ALTER TABLE contents ADD COLUMN trend_keywords_ignored TEXT NOT NULL DEFAULT '[]'");
  const trendColumns = new Set(db.prepare('PRAGMA table_info(trend_reference_sets)').all().map(({ name }) => name));
  if (!trendColumns.has('trend_hooks')) db.exec("ALTER TABLE trend_reference_sets ADD COLUMN trend_hooks TEXT NOT NULL DEFAULT '[]'");
  if (!trendColumns.has('trend_content_patterns')) db.exec("ALTER TABLE trend_reference_sets ADD COLUMN trend_content_patterns TEXT NOT NULL DEFAULT '[]'");
  if (!trendColumns.has('keyword_categories')) db.exec("ALTER TABLE trend_reference_sets ADD COLUMN keyword_categories TEXT NOT NULL DEFAULT '[]'");
  const generationColumns = new Set(db.prepare('PRAGMA table_info(ai_generations)').all().map(({ name }) => name));
  for (const [name, definition] of Object.entries({ media_type: "TEXT NOT NULL DEFAULT 'text'", assets: "TEXT NOT NULL DEFAULT '[]'", media: "TEXT NOT NULL DEFAULT '[]'", metadata: "TEXT NOT NULL DEFAULT '{}'", provider_job_id: 'TEXT', duration_ms: 'INTEGER' })) if (!generationColumns.has(name)) db.exec(`ALTER TABLE ai_generations ADD COLUMN ${name} ${definition}`);
  const providerColumns = new Set(db.prepare('PRAGMA table_info(ai_provider_settings)').all().map(({ name }) => name));
  if (!providerColumns.has('is_default')) db.exec('ALTER TABLE ai_provider_settings ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
  for (const name of ['text_model', 'image_model', 'video_model']) if (!providerColumns.has(name)) db.exec(`ALTER TABLE ai_provider_settings ADD COLUMN ${name} TEXT`);
  const assetColumns = new Set(db.prepare('PRAGMA table_info(assets)').all().map(({ name }) => name));
  if (!assetColumns.has('storage_url')) {
    db.exec("ALTER TABLE assets ADD COLUMN storage_url TEXT NOT NULL DEFAULT ''");
    db.prepare("UPDATE assets SET storage_url='/asset-files/' || storage_key WHERE storage_provider='local' AND storage_url='' ").run();
  }
  return db;
}

module.exports = { createDatabase };
