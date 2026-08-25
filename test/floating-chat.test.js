const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDatabase } = require('../src/db');
const connector = require('../src/ai/connector');
const { install, ensureSchema, buildConversationPrompt } = require('../src/services/floatingChatPatch');

const jsonResponse = body => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

test('floating chat schema and transcript builder keep multi-turn context', () => {
  const db = createDatabase(':memory:');
  ensureSchema(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'floating_chat_%' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(tables, ['floating_chat_messages', 'floating_chat_sessions']);
  const prompt = buildConversationPrompt([
    { role: 'user', content: 'Nama proyek kita Atlas.' },
    { role: 'assistant', content: 'Siap, proyeknya Atlas.' },
    { role: 'user', content: 'Apa nama proyek tadi?' }
  ]);
  assert.match(prompt, /user: Nama proyek kita Atlas/);
  assert.match(prompt, /assistant: Siap, proyeknya Atlas/);
  assert.match(prompt, /user: Apa nama proyek tadi/);
});

test('floating chat API persists messages and sends previous turns through AgentRouter API gateway', async t => {
  const db = createDatabase(':memory:');
  connector.seed(db);
  connector.save(db, 'agentrouter', {
    enabled: true,
    apiKey: 'agent-secret',
    baseUrl: 'https://api.bluesminds.com/v1',
    textModel: 'claude-opus-4-8'
  });
  connector.save(db, 'agentrouter', { isDefault: true, defaultCapability: 'text' });

  const requestBodies = [];
  const transport = async (url, options = {}) => {
    assert.equal(url, 'https://api.bluesminds.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer agent-secret');
    assert.equal(options.headers['anthropic-version'], undefined);
    const body = JSON.parse(options.body);
    requestBodies.push(body);
    const answer = requestBodies.length === 1 ? 'Halo juga.' : 'Namanya Atlas.';
    return jsonResponse({
      id: `chatcmpl-${requestBodies.length}`,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: answer },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
    });
  };

  const app = express();
  app.use(express.json());
  install({ app, db, transport });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const providers = await fetch(`${base}/api/floating-chat/providers`).then(response => response.json());
  assert.equal(providers.defaultProvider, 'agentrouter');
  assert.equal(providers.providers[0].provider, 'agentrouter');

  const session = await fetch(`${base}/api/floating-chat/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'agentrouter', model: 'claude-opus-4-8' })
  }).then(response => response.json());
  assert.ok(session.id);

  const first = await fetch(`${base}/api/floating-chat/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Halo. Nama proyek kita Atlas.' })
  }).then(response => response.json());
  assert.equal(first.assistant.content, 'Halo juga.');

  const second = await fetch(`${base}/api/floating-chat/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Apa nama proyek tadi?' })
  }).then(response => response.json());
  assert.equal(second.assistant.content, 'Namanya Atlas.');
  assert.deepEqual(requestBodies[1].messages.map(message => message.role), ['user', 'assistant', 'user']);
  const secondTranscript = requestBodies[1].messages.map(message => `${message.role}: ${message.content}`).join('\n');
  assert.match(secondTranscript, /Nama proyek kita Atlas/);
  assert.match(secondTranscript, /Halo juga/);
  assert.match(secondTranscript, /Apa nama proyek tadi/);

  const history = await fetch(`${base}/api/floating-chat/sessions/${session.id}/messages`).then(response => response.json());
  assert.equal(history.messages.length, 4);
  assert.deepEqual(history.messages.map(message => message.role), ['user', 'assistant', 'user', 'assistant']);
});
