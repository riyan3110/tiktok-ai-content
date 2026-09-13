process.env.SESSION_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const dynamic = require('../src/services/dynamicAiProviders');
const cleanup = require('../src/services/providerStorageCleanup');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aiads-provider-cleanup-'));
  const db = createDatabase(path.join(directory, 'app.db'));
  const keyFile = path.join(directory, '.provider-encryption-key');
  dynamic.ensureSchema(db);
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, keyFile };
}

function addDynamic(db, id = 'old-provider') {
  db.prepare(`INSERT INTO ai_dynamic_provider_profiles(
    id,name,base_url,api_key_encrypted,selected_model,selected_text_model,models_json,roles_json
  ) VALUES(?,?,?,?,?,?,?,?)`).run(
    id,
    'Old Provider',
    `https://${id}.invalid/v1`,
    'old-encrypted-key',
    'old-model',
    'old-model',
    JSON.stringify(['old-model', 'ghost-model']),
    JSON.stringify(['text'])
  );
  db.prepare(`UPDATE ai_dynamic_provider_state SET
    selected_provider_id=?,selected_text_provider_id=?,fallback_enabled=1,text_fallback_enabled=1
    WHERE id=1`).run(id, id);
}

function addLegacy(db, provider = 'orcarouter') {
  db.prepare('INSERT INTO ai_provider_settings(provider,base_url,api_key_encrypted,default_model,image_model,video_model,enabled) VALUES(?,?,?,?,?,?,?)')
    .run(provider, `https://${provider}.legacy.invalid/v1`, 'legacy-key', 'legacy-model', 'legacy-image', 'legacy-video', 1);
  db.prepare('INSERT INTO ai_provider_defaults(capability,provider) VALUES(?,?)').run('image', provider);
  db.prepare('INSERT INTO ai_provider_health(provider,status) VALUES(?,?)').run(provider, 'Online');
  db.prepare('INSERT INTO ai_provider_model_capabilities(provider,model_id,capability) VALUES(?,?,?)').run(provider, 'legacy-image', 'image');
}

test('storage version 0 removes every pre-manual provider and the pre-manual encryption key', t => {
  const { db, keyFile } = fixture(t);
  addDynamic(db);
  db.prepare('INSERT INTO ai_dynamic_provider_revisions(id,revision) VALUES(?,?)').run('old-provider', 7);
  addLegacy(db, 'xkiro');
  fs.writeFileSync(keyFile, Buffer.alloc(32, 1));

  const result = cleanup.run(db, { keyFile });
  assert.equal(result.migrated, true);
  assert.equal(result.version, cleanup.STORAGE_VERSION);
  assert.equal(result.encryptionKeyRemoved, true);
  assert.equal(fs.existsSync(keyFile), false);

  for (const table of cleanup.PROVIDER_TABLES) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total, 0, `${table} should be empty`);
  }
  const state = db.prepare('SELECT * FROM ai_dynamic_provider_state WHERE id=1').get();
  assert.equal(state.selected_provider_id, null);
  assert.equal(state.selected_text_provider_id, null);
  assert.equal(state.selected_image_provider_id, null);
  assert.equal(state.fallback_enabled, 0);
  assert.equal(state.text_fallback_enabled, 0);
  assert.equal(state.image_fallback_enabled, 0);
  assert.equal(db.prepare('SELECT version FROM ai_provider_storage_meta WHERE id=1').get().version, cleanup.STORAGE_VERSION);
});

test('version 1 to 2 purges returned legacy providers while preserving manually saved provider state', t => {
  const { db, keyFile } = fixture(t);
  db.exec(`CREATE TABLE IF NOT EXISTS ai_provider_storage_meta (
    id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); INSERT OR REPLACE INTO ai_provider_storage_meta(id,version) VALUES(1,1);`);

  addDynamic(db, 'manual-provider');
  db.prepare('UPDATE ai_dynamic_provider_profiles SET name=?,models_json=?,selected_model=?,selected_text_model=? WHERE id=?')
    .run('Manual Provider', JSON.stringify(['manual-model']), 'manual-model', 'manual-model', 'manual-provider');
  addLegacy(db, 'orcarouter');
  fs.writeFileSync(keyFile, Buffer.alloc(32, 7));

  const result = cleanup.run(db, { keyFile });
  assert.equal(result.migrated, true);
  assert.equal(result.version, 2);
  assert.equal(result.encryptionKeyRemoved, false);
  assert.equal(fs.existsSync(keyFile), true, 'current manual-provider encryption key must survive v2 cleanup');

  for (const table of cleanup.LEGACY_TABLES) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total, 0, `${table} should be empty after v2`);
  }
  const profile = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get('manual-provider');
  assert.equal(profile.name, 'Manual Provider');
  assert.deepEqual(JSON.parse(profile.models_json), ['manual-model']);
  const state = db.prepare('SELECT * FROM ai_dynamic_provider_state WHERE id=1').get();
  assert.equal(state.selected_text_provider_id, 'manual-provider');
  assert.equal(state.text_fallback_enabled, 1, 'explicit fallback switch must not be changed by v2 cleanup');
});

test('cleanup is one-time so provider saved after migration survives restart checks', t => {
  const { db, keyFile } = fixture(t);
  assert.equal(cleanup.run(db, { keyFile }).migrated, true);

  addDynamic(db, 'fresh-provider');
  db.prepare('UPDATE ai_dynamic_provider_profiles SET name=?,models_json=?,selected_model=?,selected_text_model=? WHERE id=?')
    .run('Fresh Provider', JSON.stringify(['fresh-model']), 'fresh-model', 'fresh-model', 'fresh-provider');

  const second = cleanup.run(db, { keyFile });
  assert.equal(second.migrated, false);
  assert.equal(second.version, cleanup.STORAGE_VERSION);
  const profile = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get('fresh-provider');
  assert.equal(profile.name, 'Fresh Provider');
  assert.deepEqual(JSON.parse(profile.models_json), ['fresh-model']);
  assert.equal(db.prepare('SELECT selected_text_provider_id FROM ai_dynamic_provider_state WHERE id=1').get().selected_text_provider_id, 'fresh-provider');
});
