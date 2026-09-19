const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createDatabase } = require('../src/db');
const providers = require('../src/services/dynamicAiProviders');
const connector = require('../src/ai/connector');

// Database fixtures only: these tests do not simulate a provider response.
function add(db, id, roles) {
  db.prepare(`INSERT INTO ai_dynamic_provider_profiles(id,name,base_url,api_key_encrypted,models_json,selected_text_model,selected_image_model,roles_json)
    VALUES(?,?,?,?,?,?,?,?)`).run(id, id, `https://${id}.invalid/v1`, 'test-ciphertext', '["catalog-model"]', roles.includes('text') ? 'catalog-model' : null, roles.includes('image') ? 'catalog-model' : null, JSON.stringify(roles));
}
function setup(t) { const db = createDatabase(':memory:'); providers.ensureSchema(db); t.after(() => db.close()); return db; }

test('empty defaults stay null, and legacy profiles are never seeded or migrated', t => {
  const db = setup(t);
  db.prepare('INSERT INTO ai_provider_settings(provider,base_url,api_key_encrypted) VALUES(?,?,?)').run('orcarouter', 'https://api.orcarouter.ai', 'legacy-secret');
  for (let i = 0; i < 3; i++) {
    connector.seed(db);
    const state = providers.publicState(db);
    assert.deepEqual(state.providers, []);
    assert.equal(state.defaults.text.providerId, null);
    assert.equal(state.defaults.image.providerId, null);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_provider_settings').get().n, 1);
});

test('Text and Image selection and fallback order are independent', t => {
  const db = setup(t);
  add(db, 'text-a', ['text']); add(db, 'text-b', ['text']); add(db, 'image-a', ['image']);
  providers.setDefault(db, 'text', 'text-a', 'catalog-model');
  providers.setDefault(db, 'image', 'image-a', 'catalog-model');
  assert.deepEqual(providers.orderedRows(db, 'text').map(x => x.id), ['text-a']);
  db.prepare('UPDATE ai_dynamic_provider_state SET text_fallback_enabled=1').run();
  assert.deepEqual(providers.orderedRows(db, 'text').map(x => x.id), ['text-a', 'text-b']);
  assert.deepEqual(providers.orderedRows(db, 'image').map(x => x.id), ['image-a']);
  assert.throws(() => providers.setDefault(db, 'image', 'text-b', 'catalog-model'), /kategori/);
  assert.throws(() => providers.setDefault(db, 'text', 'text-a', 'absent-model'), /Model tidak tersedia/);
  assert.equal(providers.publicState(db).defaults.text.providerId, 'text-a');
});

test('delete clears legacy credentials, model cache, defaults and survives a new process', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiads-provider-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'app.db'); const db = createDatabase(file);
  providers.ensureSchema(db); add(db, 'deleted', ['text', 'image']);
  providers.setDefault(db, 'text', 'deleted', 'catalog-model'); providers.setDefault(db, 'image', 'deleted', 'catalog-model');
  db.prepare('INSERT INTO ai_provider_settings(provider,base_url,api_key_encrypted) VALUES(?,?,?)').run('xkiro', 'https://deleted.invalid/v1/', 'old-key');
  db.prepare('INSERT INTO ai_provider_defaults(capability,provider) VALUES(?,?)').run('text', 'xkiro');
  db.prepare('INSERT INTO ai_provider_model_capabilities(provider,model_id,capability) VALUES(?,?,?)').run('xkiro', 'old-model', 'text');
  providers.removeProvider(db, 'deleted');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_provider_settings').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_provider_defaults').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_provider_model_capabilities').get().n, 0);
  db.close();
  const script = `const db=require('./src/db').createDatabase(process.argv[1]);require('./src/ai/connector').seed(db);console.log(JSON.stringify(require('./src/services/dynamicAiProviders').publicState(db)));db.close();`;
  const state = JSON.parse(execFileSync(process.execPath, ['-e', script, file], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }));
  assert.deepEqual(state.providers, []);
  assert.equal(state.defaults.text.providerId, null); assert.equal(state.defaults.image.providerId, null);
});

test('deleting active provider clears both roles without selecting a replacement', t => {
  const db = setup(t); add(db, 'both', ['text', 'image']); add(db, 'image-b', ['image']); add(db, 'text-b', ['text']);
  providers.setDefault(db, 'text', 'both'); providers.setDefault(db, 'image', 'both');
  db.prepare('UPDATE ai_dynamic_provider_state SET text_fallback_enabled=1,image_fallback_enabled=1').run();
  providers.removeProvider(db, 'both');
  assert.equal(providers.publicState(db).defaults.text.providerId, null);
  assert.equal(providers.publicState(db).defaults.image.providerId, null);
  assert.deepEqual(providers.orderedRows(db, 'text').map(x => x.id), []);
  assert.deepEqual(providers.orderedRows(db, 'image').map(x => x.id), []);
});

test('public state never exposes stored encrypted or plaintext keys', t => {
  const db = setup(t); add(db, 'text-a', ['text']);
  assert.ok(!JSON.stringify(providers.publicState(db)).includes('test-ciphertext'));
  assert.equal(providers.publicState(db).providers[0].api_key_encrypted, undefined);
});

test('Base URL normalization strips endpoint suffixes and rejects embedded credentials', () => {
  assert.equal(providers.normalizeBaseUrl(' HTTPS://API.EXAMPLE.COM/v1/chat/completions/ '), 'https://api.example.com/v1');
  assert.throws(() => providers.normalizeBaseUrl('https://user:password@api.example.com/v1'), /password/);
  assert.throws(() => providers.normalizeBaseUrl('https://api.example.com/v1?api_key=value'), /query/);
});

test('provider HTML does not contain the legacy cards, search or Video default', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const section = html.split('<section id="ai-providers"')[1].split('<section id="generation-queue"')[0];
  assert.doesNotMatch(section, /Default Video AI|REAL AI PROVIDER CONNECTOR|provider-search|provider-list|mock-generate/);
  const ui = fs.readFileSync(path.join(__dirname, '../public/ai-providers-simple.js'), 'utf8');
  assert.doesNotMatch(ui, /Default Video AI|Search providers/);
});

test('createApp routes refuse legacy text/image overrides when the new defaults are empty', async t => {
  const db = setup(t);
  const request = require('supertest');
  const { createApp } = require('../src/app');
  const app = createApp({ db });
  await request(app).post('/api/ai/generations').send({ mediaType: 'text', provider: 'orcarouter', prompt: 'Test' }).expect(409);
  await request(app).post('/api/content-studio/generate').send({ mediaType: 'image', provider: 'openai-images', prompt: 'Test' }).expect(409);
  await request(app).post('/api/generate/image').send({ prompt: 'Test' }).expect(409);
  const list = await request(app).get('/api/providers').expect(200);
  assert.deepEqual(list.body, []);
});

test('upgrade splits an old shared URL record and keeps both selected models after restart', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aiads-shared-upgrade-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'app.db');
  const original = createDatabase(file); providers.ensureSchema(original);
  add(original, 'shared', ['text', 'image']);
  providers.setDefault(original, 'text', 'shared'); providers.setDefault(original, 'image', 'shared');
  const schema = original.prepare("SELECT sql FROM sqlite_master WHERE name='ai_dynamic_provider_profiles'").get().sql;
  original.exec('ALTER TABLE ai_dynamic_provider_profiles RENAME TO upgrade_fixture');
  original.exec(schema.replace('base_url TEXT NOT NULL,', 'base_url TEXT NOT NULL UNIQUE,'));
  original.exec('INSERT INTO ai_dynamic_provider_profiles SELECT * FROM upgrade_fixture; DROP TABLE upgrade_fixture');
  original.close();
  const db = createDatabase(file); t.after(() => db.close());
  const current = providers.publicState(db);
  assert.equal(current.providers.length, 2);
  assert.notEqual(current.defaults.text.providerId, current.defaults.image.providerId);
  assert.equal(current.defaults.text.model, 'catalog-model');
  assert.equal(current.defaults.image.model, 'catalog-model');
  assert.ok(current.providers.every(row => row.baseUrl === 'https://shared.invalid/v1' && row.roles.length === 1));
  assert.equal(db.prepare("SELECT id FROM ai_dynamic_provider_profiles WHERE id='shared'").get(), undefined);
});
