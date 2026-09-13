process.env.SESSION_SECRET ||= require('node:crypto').randomBytes(32).toString('hex');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const dynamic = require('../src/services/dynamicAiProviders');
const cleanup = require('../src/services/providerStorageCleanup');
const { ContentStudioService } = require('../src/services/contentStudio');

function seedVersionOne(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_provider_storage_meta (
    id INTEGER PRIMARY KEY CHECK(id = 1), version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); INSERT OR REPLACE INTO ai_provider_storage_meta(id,version) VALUES(1,1);`);
}

function addManualImage(db) {
  db.prepare(`INSERT INTO ai_dynamic_provider_profiles(
    id,name,base_url,api_key_encrypted,selected_model,selected_image_model,models_json,roles_json
  ) VALUES(?,?,?,?,?,?,?,?)`).run(
    'custom-image-provider', 'Manual Image Provider', 'https://manual.example/v1',
    'encrypted-key', 'real-image-model', 'real-image-model', JSON.stringify(['real-image-model']), JSON.stringify(['image'])
  );
  db.prepare('UPDATE ai_dynamic_provider_state SET selected_image_provider_id=? WHERE id=1').run('custom-image-provider');
}

function addLegacyImageRows(db) {
  for (const provider of ['orcarouter', '9router', 'vidu', 'openai-images', 'zark', 'nanobanana']) {
    db.prepare('INSERT INTO ai_provider_settings(provider,base_url,api_key_encrypted,default_model,image_model,enabled) VALUES(?,?,?,?,?,1)')
      .run(provider, `https://${provider}.legacy.example/v1`, 'legacy-key', 'legacy-model', 'legacy-image');
  }
}

test('Content Studio does not expose retired image providers after startup cleanup', () => {
  const db = createDatabase(':memory:');
  dynamic.ensureSchema(db);
  seedVersionOne(db);
  addManualImage(db);
  addLegacyImageRows(db);

  cleanup.run(db, { keyFile: null });
  const studio = new ContentStudioService({ db, storage: null });
  const providers = studio.providers();

  assert.deepEqual(providers.map(provider => provider.name), ['Manual Image Provider']);
  assert.deepEqual(providers[0].types, ['image']);
  assert.equal(providers[0].models.image, 'real-image-model');
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ai_provider_settings').get().total, 0);
  db.close();
});
