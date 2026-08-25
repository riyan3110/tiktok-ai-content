const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const source = fs.readFileSync(gatewayPath, 'utf8');

test('redesign and lazy loader scripts are cache-busted and loaded from head with defer', () => {
  assert.match(source, /<script defer src=\"\/lazy-modules\.js\?v=startup-lazy-20260825a\"><\/script>/);
  assert.match(source, /<script defer src=\"\/floating-chat-theme\.js\?v=neo-dashboard-20260825e\"><\/script>/);
  assert.match(source, /<script defer src=\"\/neo-home-polish\.js\?v=home-polish-20260825e\"><\/script>/);
  assert.match(source, /replace\('<\/head>'/);
  assert.doesNotMatch(source, /replace\('<\/body>'/);
});

test('startup keeps only shell and Text Content core eager', () => {
  for (const script of ['/backend-foundation.js', '/workspace.js', '/background-state.js', '/app.js']) {
    assert.match(source, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /eagerPaths\.has\(pathname\)/);
  assert.doesNotMatch(source, /coreScripts\.push/);
});

test('lazy loader executes before workspace and redesign executes after core', () => {
  assert.match(source, /\[eagerScripts\[0\], lazyScript, \.\.\.eagerScripts\.slice\(1\), themeScript, polishScript\]/);
});

test('app shell disables stale HTML caching', () => {
  assert.match(source, /no-cache, max-age=0, must-revalidate/);
});
