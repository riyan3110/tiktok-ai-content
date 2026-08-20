const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const connector = require('../src/ai/connector');

function configuredPair() {
  const db = createDatabase(':memory:');
  connector.save(db, 'orcarouter', { apiKey: 'existing-orca-secret', enabled: true });
  connector.save(db, '9router', { apiKey: 'nine-gateway-secret', enabled: true });
  const transport = async url => {
    const type = new URL(url).pathname.endsWith('/image') ? 'image' : new URL(url).pathname.endsWith('/video') ? 'video' : 'text';
    return new Response(JSON.stringify({ object: 'list', data: [{ id: `nine-${type}`, owned_by: 'nine' }] }), { headers: { 'content-type': 'application/json' } });
  };
  return { db, app: createApp({ db, aiTransport: transport }) };
}

test('OrcaRouter remains available for text, image, and video', async () => {
  const { db, app } = configuredPair();
  const provider = (await request(app).get('/api/ai/providers').expect(200)).body.find(item => item.provider === 'orcarouter');
  assert.deepEqual(provider.capabilities, ['text', 'image', 'video']);
  const studio = (await request(app).get('/api/content-studio/providers').expect(200)).body.find(item => item.id === 'orcarouter');
  assert.deepEqual(studio.types, ['text', 'image', 'video']);
  db.close();
});

test('9Router is added alongside OrcaRouter in defaults and Content Studio', async () => {
  const { db, app } = configuredPair();
  const ids = (await request(app).get('/api/content-studio/providers').expect(200)).body.map(item => item.id);
  assert.ok(ids.includes('orcarouter')); assert.ok(ids.includes('9router'));
  const ui = fs.readFileSync('public/ai-providers.js', 'utf8');
  assert.match(ui, /p\.enabled&&p\.capabilities\.includes\(capability\)/);
  assert.doesNotMatch(ui, /p\.provider!==['"]9router['"]/);
  db.close();
});

test('existing OrcaRouter defaults remain unchanged when 9Router is added', async () => {
  const { db, app } = configuredPair();
  connector.save(db, 'orcarouter', { isDefault: true, defaultCapability: 'image' });
  await request(app).get('/api/ai/providers').expect(200);
  await request(app).get('/api/content-studio/providers').expect(200);
  assert.equal(db.prepare("SELECT provider FROM ai_provider_defaults WHERE capability='image'").get().provider, 'orcarouter');
  db.close();
});

test('existing OrcaRouter credentials remain intact', async () => {
  const { db, app } = configuredPair();
  const before = db.prepare("SELECT api_key_encrypted FROM ai_provider_settings WHERE provider='orcarouter'").get().api_key_encrypted;
  await request(app).put('/api/ai/providers/9router').send({ enabled: true }).expect(200);
  const after = db.prepare("SELECT api_key_encrypted FROM ai_provider_settings WHERE provider='orcarouter'").get().api_key_encrypted;
  assert.equal(after, before); assert.equal(connector.configured(connector.setting(db, 'orcarouter')).api_key, 'existing-orca-secret');
  db.close();
});

test('selecting 9Router does not disable OrcaRouter', async () => {
  const { db, app } = configuredPair();
  await request(app).put('/api/ai/providers/9router').send({ isDefault: true, defaultCapability: 'image' }).expect(200);
  assert.equal(connector.setting(db, 'orcarouter').enabled, 1);
  assert.equal(connector.setting(db, '9router').enabled, 1);
  db.close();
});

test('selecting OrcaRouter does not disable 9Router', async () => {
  const { db, app } = configuredPair();
  await request(app).put('/api/ai/providers/orcarouter').send({ isDefault: true, defaultCapability: 'video' }).expect(200);
  assert.equal(connector.setting(db, 'orcarouter').enabled, 1);
  assert.equal(connector.setting(db, '9router').enabled, 1);
  db.close();
});
