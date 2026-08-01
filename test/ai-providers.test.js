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

test('provider UI consumes the backend registry and never declares unsupported provider IDs', () => {
  const script = read('public/ai-providers.js');
  assert.match(script, /providers=await http\('\/api\/ai\/providers'\)/);
  for (const provider of ["OpenAI:'openai'", "Claude:'claude'", "Runway:'runway'", "Custom Provider", "google-omni"]) assert.ok(!script.includes(provider));
  for (const step of ['Preparing Prompt...','Sending Request...','Waiting AI...','Receiving Response...','Completed']) assert.ok(script.includes(step));
  assert.doesNotMatch(script, /fetch\s*\(/);
  assert.match(script, /defaultCapability/);
});

test('provider architecture documentation covers production concerns', () => {
  const docs = read('AI_PROVIDER_ENGINE.md');
  for (const heading of ['Architecture','Provider Adapter Pattern','Pipeline','Future Backend','Security','Credential Flow']) assert.ok(docs.includes(`## ${heading}`));
});
