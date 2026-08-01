const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

function setup() { const db = createDatabase(':memory:'); return { db, app: createApp({ db }) }; }
const valid = { name: 'Launch UGC', category: 'UGC', description: 'Template launch', targetAI: 'video', prompt: '{{hook}}: {{brand}} memperkenalkan {{product}} untuk {{audience}}', negativePrompt: 'blur', provider: 'openai', model: 'gpt-4o-mini', variables: { audience: 'Gen Z' }, tags: ['ugc', 'launch'], assets: [{ name: 'packshot', type: 'image', url: '/asset/packshot.jpg' }] };

test('database menyediakan tabel engine template tanpa mengubah tabel lama', () => { const { db } = setup(); const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name); for (const name of ['templates', 'template_versions', 'template_assets', 'template_runs', 'contents', 'ai_generations']) assert.ok(names.includes(name)); });
test('list menyertakan sembilan preset bawaan', async () => { const { app } = setup(); const response = await request(app).get('/api/templates').expect(200); assert.equal(response.body.filter(x => x.preset).length, 9); assert.ok(response.body.some(x => x.name === 'Google Veo')); });
test('create, edit, version, favorite, archive, duplicate, search, dan delete template', async () => { const { app } = setup(); const made = await request(app).post('/api/templates').send(valid).expect(201); assert.equal(made.body.assets.length, 1); assert.deepEqual(made.body.variables, { audience: 'Gen Z' }); const edited = await request(app).put(`/api/templates/${made.body.id}`).send({ name: 'Launch UGC v2', favorite: true, archived: true, folder: 'Campaign' }).expect(200); assert.equal(edited.body.version, 2); assert.equal(edited.body.favorite, true); const versions = await request(app).get(`/api/templates/${made.body.id}/versions`).expect(200); assert.equal(versions.body.length, 2); const found = await request(app).get('/api/templates').query({ search: 'v2', archived: true, favorite: true }).expect(200); assert.equal(found.body.length, 1); const copy = await request(app).post(`/api/templates/${made.body.id}/duplicate`).expect(201); assert.match(copy.body.name, /Copy/); await request(app).delete(`/api/templates/${copy.body.id}`).expect(200); });
test('validation menolak field, asset, target, temperature dan custom variable invalid', async () => { const { app } = setup(); await request(app).post('/api/templates').send({}).expect(422); await request(app).post('/api/templates').send({ ...valid, targetAI: 'audio' }).expect(422); await request(app).post('/api/templates').send({ ...valid, temperature: 3 }).expect(422); await request(app).post('/api/templates').send({ ...valid, assets: [{ type: 'image' }] }).expect(422); await request(app).post('/api/templates').send({ ...valid, prompt: '{{unknown}}', variables: {} }).expect(422); });
test('composer preview mengganti variable, menghitung token dan estimasi biaya', async () => { const { app } = setup(); const made = await request(app).post('/api/templates').send(valid); const response = await request(app).post(`/api/templates/${made.body.id}/preview`).send({ hook: 'Stop scroll', brand: 'Lab', product: 'Serum', audience: 'Gen Z' }).expect(200); assert.equal(response.body.unresolved.length, 0); assert.match(response.body.prompt, /Stop scroll: Lab memperkenalkan Serum/); assert.ok(response.body.tokenCount > 0); assert.equal(typeof response.body.estimatedCost, 'number'); assert.equal(response.body.changed, true); });
test('generate sekali, batch, queue, dan berkala dicatat di history template', async () => { const { app, db } = setup(); const made = await request(app).post('/api/templates').send(valid); const context = { hook: 'Hook', brand: 'Brand', product: 'Produk', audience: 'Gen Z' }; const once = await request(app).post(`/api/templates/${made.body.id}/generate`).send({ context }).expect(202); assert.equal(once.body.count, 1); const batch = await request(app).post(`/api/templates/${made.body.id}/generate`).send({ mode: 'batch', count: 10, context }).expect(202); assert.equal(batch.body.jobs.length, 10); const scheduled = await request(app).post(`/api/templates/${made.body.id}/generate`).send({ mode: 'scheduled', count: 1, scheduledAt: '2026-08-02T10:00:00Z', context }).expect(202); assert.equal(scheduled.body.mode, 'scheduled'); assert.equal(db.prepare('SELECT COUNT(*) count FROM template_runs WHERE template_id=?').get(made.body.id).count, 12); await request(app).post(`/api/templates/${made.body.id}/generate`).send({ mode: 'batch', count: 101, context }).expect(422); });
test('generate menolak variable kosong dan export mendukung JSON Markdown TXT', async () => { const { app } = setup(); const made = await request(app).post('/api/templates').send(valid); await request(app).post(`/api/templates/${made.body.id}/generate`).send({ context: {} }).expect(422); const json = await request(app).get(`/api/templates/${made.body.id}/export/json`).expect(200); assert.equal(json.body.name, valid.name); const md = await request(app).get(`/api/templates/${made.body.id}/export/markdown`).expect(200); assert.match(md.text, /## Prompt/); const txt = await request(app).get(`/api/templates/${made.body.id}/export/txt`).expect(200); assert.equal(txt.text, valid.prompt); });

test('hotfix end-to-end: preset detail, favorite persistence, duplicate, edit, delete, import/export dan active draft', async () => {
  const { app } = setup();
  const initial = await request(app).get('/api/templates').expect(200);
  assert.equal(initial.body.filter(item => item.preset).length, 9);
  const youtube = initial.body.find(item => item.name === 'YouTube Shorts');
  const imageAds = initial.body.find(item => item.name === 'Image Ads');
  const detail = await request(app).get(`/api/templates/${youtube.id}`).expect(200);
  for (const field of ['name','description','category','target_ai','prompt','negative_prompt','provider','model','duration','resolution','aspect_ratio','platform','style','voice','referenceImages','tags','version']) assert.ok(Object.hasOwn(detail.body, field), field);

  await request(app).put(`/api/templates/${youtube.id}`).send({ favorite: true }).expect(200);
  const favorites = await request(app).get('/api/templates?favorite=true&archived=false').expect(200);
  assert.ok(favorites.body.some(item => item.id === youtube.id && item.favorite));
  await request(app).put(`/api/templates/${youtube.id}`).send({ name: 'Forbidden' }).expect(403);
  await request(app).delete(`/api/templates/${youtube.id}`).expect(403);

  const copy = await request(app).post(`/api/templates/${youtube.id}/duplicate`).expect(201);
  assert.match(copy.body.name, /^Copy of /); assert.equal(copy.body.preset, false); assert.notEqual(copy.body.id, youtube.id);
  const edited = await request(app).put(`/api/templates/${copy.body.id}`).send({ name: 'Edited custom', folder: 'Campaign' }).expect(200);
  assert.equal(edited.body.name, 'Edited custom'); assert.equal(edited.body.version, 2);
  assert.equal((await request(app).get(`/api/templates/${copy.body.id}`)).body.folder, 'Campaign');

  const videoDraft = await request(app).post(`/api/templates/${youtube.id}/use`).expect(200);
  assert.equal(videoDraft.body.destination, 'studio');
  const savedDraft = await request(app).get('/api/templates/active-draft').expect(200);
  assert.equal(savedDraft.body.template_id, youtube.id); assert.equal(savedDraft.body.snapshot.name, 'YouTube Shorts');
  assert.equal((await request(app).post(`/api/templates/${imageAds.id}/use`).expect(200)).body.destination, 'generator');

  const exported = await request(app).get(`/api/templates/${copy.body.id}/export/json`).expect(200);
  const imported = await request(app).post('/api/templates/import').send(exported.body).expect(201);
  assert.match(imported.body.name, /^Copy of /); assert.notEqual(imported.body.id, copy.body.id);
  await request(app).post('/api/templates/import').send({ broken: true }).expect(422);
  await request(app).delete(`/api/templates/${copy.body.id}`).expect(200);
  await request(app).get(`/api/templates/${copy.body.id}`).expect(404);
});

test('hotfix frontend memakai delegation dan menyediakan semua aksi template', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/templates.js'), 'utf8');
  assert.match(source, /template-manager'\)\.addEventListener\('click'/);
  for (const action of ['preview','use','favorite','menu','edit','duplicate','move','export','delete']) assert.match(source, new RegExp(`action === '${action}'`));
  assert.match(source, /template-import-file/); assert.match(source, /active-draft/); assert.doesNotMatch(source, /\/generate`/);
});
