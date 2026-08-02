const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('AI Integration stays implemented without a sidebar entry', () => {
  const html = read('public/index.html');
  const workspace = read('public/workspace.js');
  assert.doesNotMatch(html, /href="#ai-integration"/);
  assert.match(html, /id="ai-integration"/);
  assert.match(html, /ai-integration\.js/);
  assert.match(workspace, /location\.hash === '#ai-integration' \? 'integration'/);
});

test('adapter implements normalized mock-only contract', () => {
  const source = read('public/ai-integration.js');
  for (const method of ['buildRequest', 'validate', 'send', 'parse', 'cancel', 'health']) assert.match(source, new RegExp(`${method}\\(`));
  for (const provider of ['Gemini Mock', 'OpenAI Mock', 'Claude Mock', 'Flow Mock', 'Veo Mock']) assert.ok(source.includes(provider));
  for (const key of ['integration.config', 'integration.logs', 'integration.health']) assert.ok(source.includes(key));
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(source, /apiKey|api_key/i);
});

test('security and backend integration are documented', () => {
  const docs = read('AI_INTEGRATION_LAYER.md');
  for (const heading of ['Architecture', 'Adapter Pattern', 'Transport Layer', 'Security Model', 'Backend Contract', 'Streaming Plan', 'Future API Integration']) assert.ok(docs.includes(`## ${heading}`));
  assert.match(docs, /frontend never accepts, persists, logs, or transmits a real API key/i);
});
