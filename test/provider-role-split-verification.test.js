const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dynamicAi = require('../src/services/dynamicAiProviders');
const dynamicTextBridge = require('../src/services/dynamicTextBridge');
const { stripLegacyProviderUi } = require('../src/services/siteAuthGateway');

test('dynamic provider role modules load and expose unified text helpers', () => {
  assert.equal(typeof dynamicAi.install, 'function');
  assert.equal(typeof dynamicAi.executeMessages, 'function');
  assert.equal(typeof dynamicAi.executeImage, 'function');
  assert.equal(typeof dynamicAi.createTextClient, 'function');
  assert.equal(typeof dynamicTextBridge.install, 'function');
});

test('provider browser module is valid JavaScript', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'public', 'ai-providers-simple.js'), 'utf8');
  assert.doesNotThrow(() => new Function(file));
});

test('authenticated app shell removes legacy provider UI before rendering', () => {
  const html = '<main><section id="ai-providers" class="provider-engine hidden"><p>OLD PROVIDER UI</p></section><section id="generation-queue" class="hidden"></section></main><script src="/ai-providers.js"></script>';
  const result = stripLegacyProviderUi(html);
  assert.match(result, /<section id="ai-providers" class="page-view hidden"><\/section>/);
  assert.doesNotMatch(result, /OLD PROVIDER UI/);
  assert.doesNotMatch(result, /ai-providers\.js/);
  assert.match(result, /id="generation-queue"/);
});
