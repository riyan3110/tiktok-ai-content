const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const polishPath = path.join(__dirname, '..', 'public', 'neo-home-polish.js');
const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const polish = fs.readFileSync(polishPath, 'utf8');
const gateway = fs.readFileSync(gatewayPath, 'utf8');

test('neo home polish script parses', () => {
  assert.doesNotThrow(() => new Function(polish));
});

test('home polish removes drawer, rehomes TikTok, mounts logo, and fixes history contrast', () => {
  for (const marker of [
    '.sidebar',
    '.menu-button',
    '.neo-home-tiktok',
    '#tiktok-connection',
    '.sidebar-brand img',
    '.history-item',
    'var(--neo-white)',
    'has-home-tiktok'
  ]) assert.match(polish, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(polish, /fetch\s*\(/);
  assert.doesNotMatch(polish, /XMLHttpRequest/);
});

test('TikTok Home connection controls stay compact on mobile', () => {
  assert.match(polish, /min-height:40px!important/);
  assert.match(polish, /grid-template-columns:minmax\(0,1fr\) auto!important/);
  assert.match(polish, /min-height:26px!important/);
  assert.match(polish, /font-size:\.58rem!important/);
  assert.match(polish, /flex-wrap:nowrap!important/);
  assert.doesNotMatch(polish, /flex-direction:column!important/);
});

test('home polish observes only Home/TikTok chrome instead of the whole document', () => {
  assert.match(polish, /observer\.observe\(sidebar, \{ childList: true \}\)/);
  assert.match(polish, /observer\.observe\(card, \{ childList: true \}\)/);
  assert.doesNotMatch(polish, /observe\(document\.documentElement/);
  assert.doesNotMatch(polish, /attributes:\s*true/);
});

test('authenticated app shell loads polish after the neo theme', () => {
  const themeIndex = gateway.indexOf('/floating-chat-theme.js');
  const polishIndex = gateway.indexOf('/neo-home-polish.js');
  assert.ok(themeIndex >= 0);
  assert.ok(polishIndex > themeIndex);
});
