const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const connector = require('../src/ai/connector');

const html = fs.readFileSync('public/index.html', 'utf8');
const script = fs.readFileSync('public/content-studio.js', 'utf8');
const setup = () => { const db = createDatabase(':memory:'); return { db, app: createApp({ db }) }; };
const enable = (db, provider, changes = {}) => connector.save(db, provider, { apiKey: 'secret', enabled: true, ...changes });

test('text-only OrcaRouter never appears as an image or video Content Studio provider', async () => {
  const { db, app } = setup(); enable(db, 'orcarouter');
  const providers = (await request(app).get('/api/content-studio/providers').expect(200)).body;
  assert.equal(providers.some(provider => provider.types.includes('image') || provider.types.includes('video')), false);
  assert.deepEqual(providers[0].types, ['text']); db.close();
});

test('Content Studio contains explained image and video empty states instead of a blank select', () => {
  assert.match(html, /id="studio-provider-warning"[^>]*role="alert"/);
  assert.match(script, /Belum ada provider video yang aktif\./);
  assert.match(script, /Belum ada provider gambar yang aktif\./);
  assert.match(script, /classList\.toggle\('hidden',empty\|\|single\)/);
  assert.match(script, /studio-generate'\)\.disabled=empty/);
  assert.match(script, /studio-model'\)\.disabled=empty/);
});

test('empty-state action opens AI Providers and returning to Studio refreshes provider data', () => {
  assert.match(html, />Buka AI Providers<\/button>/);
  assert.match(script, /location\.hash='ai-providers'/);
  assert.match(script, /location\.hash==='#studio'\)loadProviders\(\)/);
});

test('configured video and image providers appear after provider data is refreshed', async () => {
  const { db, app } = setup();
  assert.deepEqual((await request(app).get('/api/content-studio/providers')).body, []);
  enable(db, 'google-veo');
  let refreshed = (await request(app).get('/api/content-studio/providers').expect(200)).body;
  assert.ok(refreshed.some(provider => provider.id === 'google-veo' && provider.types.includes('video')));
  enable(db, 'google-imagen');
  refreshed = (await request(app).get('/api/content-studio/providers').expect(200)).body;
  assert.ok(refreshed.some(provider => provider.id === 'google-imagen' && provider.types.includes('image')));
  db.close();
});

test('storage checking has success and failure terminal UI states', () => {
  assert.match(script, /Tencent COS/); assert.match(script, /Local Storage/);
  assert.match(script, /Storage unavailable/); assert.match(script, /Storage tidak dapat diperiksa/);
  assert.match(script, /setTimeout\(\(\)=>controller\.abort\(\),8000\)/);
});

test('Content Studio provider filtering remains capability-specific and factory-registered', async () => {
  const { db, app } = setup(); enable(db, 'google-veo'); enable(db, 'openai-images');
  const providers = (await request(app).get('/api/content-studio/providers').expect(200)).body;
  assert.deepEqual(providers.find(provider => provider.id === 'google-veo').types, ['video']);
  assert.deepEqual(providers.find(provider => provider.id === 'openai-images').types, ['image']);
  assert.match(script, /p\.types\.includes\(media\)/);
  assert.match(fs.readFileSync('src/ai/connector.js', 'utf8'), /registered\.has\(row\.provider\)/);
  db.close();
});
