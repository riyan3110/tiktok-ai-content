const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gateway = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'performance-shell.js'), 'utf8');
const stableCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'ui-stability.css'), 'utf8');

test('fresh refresh does not depend on Assets for compact Text Content CSS', () => {
  assert.match(gateway, /asset-compact\.css\?v=compact-20260825b/);
  assert.match(gateway, /data-asset-compact/);
  assert.match(shell, /ensureBlackBackgroundOption/);
  assert.match(shell, /background-black-option/);
  assert.match(shell, /value="#0B0B0D"/);
});

test('floating chat core is guaranteed before its visual theme', () => {
  const core = gateway.indexOf('/floating-chat.js?v=floating-chat-20260825a');
  const theme = gateway.indexOf('/floating-chat-theme.js?v=neo-dashboard-20260825g');
  assert.ok(core >= 0);
  assert.ok(theme > core);
});

test('Content Studio legacy dark form surfaces are overridden by stable light surfaces', () => {
  assert.match(stableCss, /#content-studio \.form-section/);
  assert.match(stableCss, /background:#fffefa!important/);
  assert.match(stableCss, /#content-studio \.provider-empty-warning/);
  assert.match(stableCss, /background:#fff5d8!important/);
  assert.match(stableCss, /#content-studio \.result-preview/);
  assert.match(stableCss, /background:#eef1f3!important/);
});

test('floating launcher remains above the mobile bottom navigation', () => {
  assert.match(stableCss, /\.aiads-chat-launcher/);
  assert.match(stableCss, /bottom:calc\(82px \+ env\(safe-area-inset-bottom\)\)!important/);
  assert.match(stableCss, /z-index:2147483000!important/);
});
