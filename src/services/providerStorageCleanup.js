const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const STORAGE_VERSION = 2;
const LEGACY_TABLES = [
  'ai_provider_defaults',
  'ai_provider_health',
  'ai_provider_model_capabilities',
  'ai_provider_settings'
];
const PROVIDER_TABLES = [
  'ai_dynamic_provider_revisions',
  'ai_dynamic_provider_profiles',
  ...LEGACY_TABLES
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

function clearTables(db, tables) {
  let clearedRows = 0;
  for (const table of tables) {
    if (!tableExists(db, table)) continue;
    clearedRows += Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total || 0);
    db.prepare(`DELETE FROM ${table}`).run();
  }
  return clearedRows;
}

function resetDynamicState(db) {
  if (!tableExists(db, 'ai_dynamic_provider_state')) return;
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

function run(db, { keyFile = encryptionKeyFile() } = {}) {
  ensureMeta(db);
  const before = Number(db.prepare('SELECT version FROM ai_provider_storage_meta WHERE id=1').get()?.version || 0);
  if (before >= STORAGE_VERSION) return { migrated: false, version: before, clearedRows: 0, encryptionKeyRemoved: false };

  let version = before;
  let clearedRows = 0;
  let encryptionKeyRemoved = false;

  // Version 1 was the destructive, one-time reset used to remove every provider
  // that existed before the manual Base URL + API Key flow. Keep that behavior
  // only for databases that never received the v1 migration.
  if (version < 1) {
    db.transaction(() => {
      clearedRows += clearTables(db, PROVIDER_TABLES);
      resetDynamicState(db);
      db.prepare('UPDATE ai_provider_storage_meta SET version=1,updated_at=CURRENT_TIMESTAMP WHERE id=1').run();
    })();

    if (keyFile && fs.existsSync(keyFile)) {
      try {
        fs.rmSync(keyFile, { force: true });
        encryptionKeyRemoved = true;
      } catch (error) {
        console.warn('[Provider Cleanup] Kunci enkripsi lama tidak dapat dihapus:', error.message);
      }
    }
    version = 1;
  }

  // Version 2 fixes VPSes that had already completed v1 but still retained or
  // later regained rows from the old provider system. Purge only legacy tables:
  // manually saved dynamic providers, their encrypted API keys, selected models,
  // fallback switches, and the current encryption key MUST survive this step.
  if (version < 2) {
    db.transaction(() => {
      clearedRows += clearTables(db, LEGACY_TABLES);
      if (tableExists(db, 'ai_dynamic_provider_state')) {
        db.prepare(`
          UPDATE ai_dynamic_provider_state
          SET selected_provider_id=NULL,
              migration_done=1,
              updated_at=CURRENT_TIMESTAMP
          WHERE id=1
        `).run();
      }
      db.prepare('UPDATE ai_provider_storage_meta SET version=2,updated_at=CURRENT_TIMESTAMP WHERE id=1').run();
    })();
    version = 2;
  }

  return { migrated: true, version, clearedRows, encryptionKeyRemoved };
}

module.exports = { run, STORAGE_VERSION, PROVIDER_TABLES, LEGACY_TABLES, encryptionKeyFile };
