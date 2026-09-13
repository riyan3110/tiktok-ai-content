const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('preserved prompt generator uses configured Text AI endpoint', () => {
  const source = read('public/google-studio-preserved.js');
  assert.match(source, /Buat Prompt dengan AI/);
  assert.match(source, /id=\"prompt-simple-form\"/);
  assert.match(source, /\/api\/ai\/generations/);
  assert.match(source, /mediaType: 'text'/);
  assert.match(source, /prompt-ref/);
});

test('app shell applies neo theme before deferred UI scripts', () => {
  const source = read('src/services/siteAuthGateway.js');
  assert.match(source, /class=\"aiads-neo-theme\"/);
  assert.match(source, /criticalThemeStyles/);
  assert.match(source, /google-studio-preserved\.css/);
  assert.match(source, /google-studio-preserved\.js/);
});

test('suspended automation no longer watches the full document tree', () => {
  const source = read('public/automation-suspend.js');
  assert.doesNotMatch(source, /new MutationObserver\(applySuspendedUi\)/);
  assert.match(source, /hashchange/);
});

test('legacy advanced generator is not lazy-loaded over the preserved prompt UI', () => {
  const source = read('public/lazy-modules.js');
  assert.match(source, /generator:\s*\[\]/);
});

test('provider implementation is not replaced by the Google Studio snapshot', () => {
  const source = read('src/services/strictProviderDelete.js');
  assert.match(source, /module\.exports/);
});
