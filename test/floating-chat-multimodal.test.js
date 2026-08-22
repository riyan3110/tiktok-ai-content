const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createDatabase } = require('../src/db');
const connector = require('../src/ai/connector');
const { install, ensureSchema } = require('../src/services/floatingChatPatch');

test('floating chat schema migrates media metadata columns safely', () => {
  const db = createDatabase(':memory:');
  ensureSchema(db);
  ensureSchema(db);
  const columns = db.prepare('PRAGMA table_info(floating_chat_messages)').all().map(row => row.name);
  for (const name of ['media_type', 'media_url', 'asset_id', 'job_id', 'attachments_json']) assert.ok(columns.includes(name), name);
});

test('completed Content Studio result can be linked into chat without duplicating the asset', async t => {
  const db = createDatabase(':memory:');
  connector.seed(db);
  connector.save(db, 'agentrouter', { enabled: true, apiKey: 'secret', textModel: 'claude-opus-4-8' });
  connector.save(db, 'agentrouter', { isDefault: true, defaultCapability: 'text' });
  const app = express();
  app.use(express.json());
  install({ app, db, transport: async () => { throw new Error('text transport not expected'); } });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/api/floating-chat/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'agentrouter', model: 'claude-opus-4-8' }) }).then(r => r.json());

  const request = await fetch(`${base}/api/floating-chat/sessions/${session.id}/media-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Buat gambar produk futuristik', assetIds: ['asset-ref-1'] }) }).then(r => r.json());
  assert.equal(request.user.attachments[0].id, 'asset-ref-1');

  db.prepare("INSERT INTO ai_generations(id,provider,model,prompt,status,media_type,media,metadata) VALUES(?,?,?,?,?,?,?,?)")
    .run('job-image-1', 'google-imagen', 'imagen-test', 'Buat gambar', 'Completed', 'image', JSON.stringify([{ url: '/api/assets/generated-1/preview', assetId: 'generated-1', mimeType: 'image/png' }]), JSON.stringify({ generatedAssetId: 'generated-1', resultUrl: '/api/assets/generated-1/preview' }));

  const result = await fetch(`${base}/api/floating-chat/sessions/${session.id}/media-result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job-image-1' }) }).then(r => r.json());
  assert.equal(result.assistant.mediaType, 'image');
  assert.equal(result.assistant.assetId, 'generated-1');
  assert.equal(result.assistant.mediaUrl, '/api/assets/generated-1/preview');
  assert.equal(result.assistant.jobId, 'job-image-1');
  assert.match(result.assistant.content, /Assets/);
});

test('floating chat UI exposes fullscreen, image upload, natural media routing and Content Studio reuse', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'floating-chat.js'), 'utf8');
  assert.match(source, /data-chat-fullscreen/);
  assert.match(source, /accept="image\/\*"/);
  assert.match(source, /detectIntent/);
  assert.match(source, /Default Image\/Video AI/);
  assert.match(source, /\/api\/content-studio\/generate/);
  assert.match(source, /\/api\/assets\/upload/);
  assert.match(source, /Download/);
  assert.match(source, /Assets ✓/);
});
