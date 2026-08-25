const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const source = fs.readFileSync(gatewayPath, 'utf8');

test('global shell, lazy loader and redesign are cache-busted and deferred from head', () => {
  assert.match(source, /<script defer src=\"\/performance-shell\.js\?v=global-perf-20260825a\"><\/script>/);
  assert.match(source, /<script defer src=\"\/lazy-modules\.js\?v=global-perf-20260825a\"><\/script>/);
  assert.match(source, /<script defer src=\"\/floating-chat-theme\.js\?v=neo-dashboard-20260825f\"><\/script>/);
  assert.match(source, /<script defer src=\"\/neo-home-polish\.js\?v=home-polish-20260825f\"><\/script>/);
  assert.match(source, /replace\('<\/head>'/);
  assert.doesNotMatch(source, /replace\('<\/body>'/);
});

test('startup keeps only backend foundation and workspace navigation eager', () => {
  assert.match(source, /'\/backend-foundation\.js'/);
  assert.match(source, /'\/workspace\.js'/);
  assert.doesNotMatch(source, /eagerPaths = new Set\(\[[\s\S]*'\/background-state\.js'/);
  assert.doesNotMatch(source, /eagerPaths = new Set\(\[[\s\S]*'\/app\.js'/);
  assert.match(source, /eagerPaths\.has\(pathname\)/);
});

test('startup order makes shell interactive before workspace and redesign', () => {
  assert.match(source, /eagerScripts\.get\('\/backend-foundation\.js'\)[\s\S]*performanceScript[\s\S]*lazyScript[\s\S]*eagerScripts\.get\('\/workspace\.js'\)[\s\S]*themeScript[\s\S]*polishScript/);
});

test('app shell disables stale HTML caching', () => {
  assert.match(source, /no-cache, max-age=0, must-revalidate/);
});
