const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const STORAGE_VERSION = 1;
const PROVIDER_TABLES = [
  'ai_dynamic_provider_revisions',
  'ai_dynamic_provider_profiles',
  'ai_provider_defaults',
  'ai_provider_health',
  'ai_provider_model_capabilities',
  'ai_provider_settings'
];

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function encryptionKeyFile() {
  return path.join(path.dirname(config.databasePath), '.provider-encryption-key');
}

function ensureMeta(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_provider_storage_meta (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO ai_provider_storage_meta(id, version) VALUES(1, 0);
  `);
}

function run(db, { keyFile = encryptionKeyFile() } = {}) {
  ensureMeta(db);
  const before = Number(db.prepare('SELECT version FROM ai_provider_storage_meta WHERE id=1').get()?.version || 0);
  if (before >= STORAGE_VERSION) return { migrated: false, version: before, clearedRows: 0, encryptionKeyRemoved: false };

  let clearedRows = 0;
  db.transaction(() => {
    for (const table of PROVIDER_TABLES) {
      if (!tableExists(db, table)) continue;
      clearedRows += Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total || 0);
      db.prepare(`DELETE FROM ${table}`).run();
    }

    if (tableExists(db, 'ai_dynamic_provider_state')) {
      db.prepare(`
        UPDATE ai_dynamic_provider_state
        SET selected_provider_id=NULL,
            selected_text_provider_id=NULL,
            selected_image_provider_id=NULL,
            fallback_enabled=0,
            text_fallback_enabled=0,
            image_fallback_enabled=0,
            migration_done=1,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=1
      `).run();
    }

    db.prepare('UPDATE ai_provider_storage_meta SET version=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(STORAGE_VERSION);
  })();

  let encryptionKeyRemoved = false;
  if (keyFile && fs.existsSync(keyFile)) {
    try {
      fs.rmSync(keyFile, { force: true });
      encryptionKeyRemoved = true;
    } catch (error) {
      console.warn('[Provider Cleanup] Kunci enkripsi lama tidak dapat dihapus:', error.message);
    }
  }

  return { migrated: true, version: STORAGE_VERSION, clearedRows, encryptionKeyRemoved };
}

module.exports = { run, STORAGE_VERSION, PROVIDER_TABLES, encryptionKeyFile };
