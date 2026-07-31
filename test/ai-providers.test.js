const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('AI Providers workspace is routed below Prompt Generator and preserves legacy studio', () => {
  const html = read('public/index.html');
  assert.ok(html.indexOf('data-workspace-view="providers"') > html.indexOf('data-workspace-view="generator"'));
  assert.match(html, /id="ai-providers"/);
  assert.match(html, /id="legacy-studio"/);
  assert.match(read('public/workspace.js'), /view === 'providers'/);
});

test('provider engine ships adapters, local contracts, security controls, and mock pipeline', () => {
  const script = read('public/ai-providers.js');
  for (const key of ['providers.config','providers.history','providers.default']) assert.ok(script.includes(key));
  for (const provider of ['Google Flow','Google Veo','Google Gemini','OpenAI','Claude','Runway','Kling','Vidu','Hailuo','Pika','Custom Provider']) assert.ok(script.includes(provider));
  for (const step of ['Preparing Prompt...','Sending Request...','Waiting AI...','Receiving Response...','Completed']) assert.ok(script.includes(step));
  assert.doesNotMatch(script, /fetch\s*\(/);
  for (const action of ["'toggle'","'copy'","'clear'","'test'","'duplicate'","'delete'"]) assert.ok(script.includes(action));
});

test('provider architecture documentation covers production concerns', () => {
  const docs = read('AI_PROVIDER_ENGINE.md');
  for (const heading of ['Architecture','Provider Adapter Pattern','Pipeline','Future Backend','Security','Credential Flow']) assert.ok(docs.includes(`## ${heading}`));
});
