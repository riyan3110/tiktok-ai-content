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

test('home polish removes drawer, rehomes TikTok beside READY, mounts logo, and fixes history contrast', () => {
  for (const marker of [
    '.sidebar',
    '.menu-button',
    '.neo-home-tiktok',
    '.neo-status-cluster',
    '.neo-profile-chip',
    '#tiktok-connection',
    '.sidebar-brand img',
    '.history-item',
    'var(--neo-white)',
    'has-home-tiktok'
  ]) assert.match(polish, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(polish, /fetch\s*\(/);
  assert.doesNotMatch(polish, /XMLHttpRequest/);
});

test('TikTok controls are compact and READY becomes green when connected', () => {
  assert.match(polish, /min-height:25px!important/);
  assert.match(polish, /font-size:\.57rem!important/);
  assert.match(polish, /flex-wrap:nowrap!important/);
  assert.match(polish, /data-tiktok-state="connected"/);
  assert.match(polish, /#c9f7d7!important/);
  assert.match(polish, /syncReadyState/);
  assert.match(polish, /chip\.dataset\.tiktokState = state/);
});

test('TikTok status cluster moves connection and READY into the same header area', () => {
  assert.match(polish, /cluster\.appendChild\(connection\)/);
  assert.match(polish, /cluster\.appendChild\(chip\)/);
  assert.match(polish, /connect\.textContent = 'Connect TikTok'/);
});

test('home polish observes only Home/TikTok chrome and TikTok state changes', () => {
  assert.match(polish, /observer\.observe\(sidebar, \{ childList: true \}\)/);
  assert.match(polish, /observer\.observe\(card, \{ childList: true \}\)/);
  assert.match(polish, /observer\.observe\(connection, \{ attributes: true, attributeFilter: \['data-state'\] \}\)/);
  assert.doesNotMatch(polish, /observe\(document\.documentElement/);
});

test('authenticated app shell loads polish after the neo theme', () => {
  const themeIndex = gateway.indexOf('/floating-chat-theme.js');
  const polishIndex = gateway.indexOf('/neo-home-polish.js');
  assert.ok(themeIndex >= 0);
  assert.ok(polishIndex > themeIndex);
});
