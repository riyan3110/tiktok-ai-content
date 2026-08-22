const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const { ensureSchema, buildConversationMessages } = require('../src/services/floatingChatPatch');

test('floating chat schema keeps attachment and legacy media metadata columns safely', () => {
  const db = createDatabase(':memory:');
  ensureSchema(db);
  ensureSchema(db);
  const columns = db.prepare('PRAGMA table_info(floating_chat_messages)').all().map(row => row.name);
  for (const name of ['media_type', 'media_url', 'asset_id', 'job_id', 'attachments_json']) assert.ok(columns.includes(name), name);
});

test('floating chat sends native user and assistant turns without injected persona instructions', () => {
  const messages = buildConversationMessages([
    { role: 'user', content: 'Halo' },
    { role: 'assistant', content: 'Hai' },
    { role: 'user', content: 'Menurutmu gimana?' }
  ]);
  assert.deepEqual(messages, [
    { role: 'user', content: 'Halo' },
    { role: 'assistant', content: 'Hai' },
    { role: 'user', content: 'Menurutmu gimana?' }
  ]);
  assert.equal(messages.some(message => /You are|Always reply|AI Ads Lab/i.test(String(message.content))), false);
});

test('web content is attached as context to the latest user turn without adding a system persona', () => {
  const messages = buildConversationMessages([
    { role: 'user', content: 'Tolong baca URL ini' }
  ], '<SOURCE>isi artikel</SOURCE>');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.match(messages[0].content, /Tolong baca URL ini/);
  assert.match(messages[0].content, /isi artikel/);
});

test('floating chat UI remains text chat with image upload and no media generation routing', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'floating-chat.js'), 'utf8');
  assert.match(source, /data-chat-fullscreen/);
  assert.match(source, /accept="image\/\*"/);
  assert.match(source, /\/api\/assets\/upload/);
  assert.doesNotMatch(source, /detectIntent/);
  assert.doesNotMatch(source, /\/api\/content-studio\/generate/);
});
