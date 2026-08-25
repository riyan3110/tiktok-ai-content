const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const source = fs.readFileSync(gatewayPath, 'utf8');

test('global shell, lazy loader and redesign are cache-busted and deferred from head', () => {
  assert.match(source, /<script defer src=\"\/performance-shell\.js\?v=global-perf-20260825b\"><\/script>/);
  assert.match(source, /<script defer src=\"\/lazy-modules\.js\?v=global-perf-20260825b\"><\/script>/);
  assert.match(source, /<script defer src=\"\/floating-chat\.js\?v=floating-chat-20260825a\"><\/script>/);
  assert.match(source, /<script defer src=\"\/floating-chat-theme\.js\?v=neo-dashboard-20260825g\"><\/script>/);
  assert.match(source, /<script defer src=\"\/neo-home-polish\.js\?v=home-polish-20260825h\"><\/script>/);
  assert.match(source, /replace\('<\/head>'/);
  assert.doesNotMatch(source, /replace\('<\/body>'/);
});

test('stable responsive styles are loaded on every fresh app shell', () => {
  assert.match(source, /<link rel=\"stylesheet\" href=\"\/asset-compact\.css\?v=compact-20260825b\" data-asset-compact>/);
  assert.match(source, /<link rel=\"stylesheet\" href=\"\/ui-stability\.css\?v=ui-stability-20260825a\">/);
  assert.match(source, /<link rel=\"stylesheet\" href=\"\/responsive-professional\.css\?v=responsive-20260825b\">/);
});

test('startup keeps only backend foundation and workspace navigation eager', () => {
  assert.match(source, /'\/backend-foundation\.js'/);
  assert.match(source, /'\/workspace\.js'/);
  assert.doesNotMatch(source, /eagerPaths = new Set\(\[[\s\S]*'\/background-state\.js'/);
  assert.doesNotMatch(source, /eagerPaths = new Set\(\[[\s\S]*'\/app\.js'/);
  assert.match(source, /eagerPaths\.has\(pathname\)/);
});

test('startup order loads chat core before its theme and polish', () => {
  assert.match(source, /eagerScripts\.get\('\/backend-foundation\.js'\)[\s\S]*performanceScript[\s\S]*lazyScript[\s\S]*eagerScripts\.get\('\/workspace\.js'\)[\s\S]*chatScript[\s\S]*themeScript[\s\S]*polishScript/);
  assert.ok(source.indexOf('floating-chat.js?v=floating-chat-20260825a') < source.indexOf('floating-chat-theme.js?v=neo-dashboard-20260825g'));
});

test('app shell disables stale HTML caching', () => {
  assert.match(source, /no-cache, max-age=0, must-revalidate/);
});
