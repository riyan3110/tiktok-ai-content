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

test('TikTok has one compact state-aware button and READY becomes green when connected', () => {
  assert.match(polish, /min-height:30px!important/);
  assert.match(polish, /font-size:\.72rem!important/);
  assert.match(polish, /flex-wrap:nowrap!important/);
  assert.match(polish, /\.neo-tiktok-label/);
  assert.match(polish, /\.neo-tiktok-primary/);
  assert.match(polish, /primary\.textContent = connected \? 'Connected'/);
  assert.match(polish, /: 'Connect'/);
  assert.match(polish, /data-tiktok-state="connected"/);
  assert.match(polish, /#c9f7d7!important/);
  assert.match(polish, /syncReadyState/);
  assert.match(polish, /chip\.dataset\.tiktokState = state/);
});

test('TikTok status cluster moves one state-aware control and READY into the same header area', () => {
  assert.match(polish, /cluster\.appendChild\(connection\)/);
  assert.match(polish, /cluster\.appendChild\(chip\)/);
  assert.match(polish, /syncPrimaryTikTokButton\(connection\)/);
  assert.match(polish, /label\.textContent = 'TikTok'/);
  assert.match(polish, /primary\.dataset\.tiktokPrimary/);
});

test('provider page keeps the shared parent width and responsive layout', () => {
  assert.match(polish, /main\{margin-left:0!important;width:100%!important/);
  assert.match(polish, /#ai-providers\{margin:0!important;overflow-x:hidden!important/);
  assert.match(polish, /@media\(max-width:767px\)/);
  assert.match(polish, /#ai-providers\{width:100%!important;max-width:100%!important;margin:0!important;padding:0!important/);
  assert.match(polish, /#ai-providers \.provider-layout\{display:block!important;width:100%!important/);
  assert.match(polish, /#ai-providers \.provider-form \.form-grid\{grid-template-columns:1fr!important/);
  assert.match(polish, /@media\(min-width:1024px\)/);
  assert.match(polish, /#ai-providers \.provider-layout\{grid-template-columns:260px minmax\(0,1fr\)!important/);
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
