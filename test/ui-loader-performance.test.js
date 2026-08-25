const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const source = fs.readFileSync(gatewayPath, 'utf8');

test('redesign scripts are cache-busted and loaded from head with defer', () => {
  assert.match(source, /<script defer src=\"\/floating-chat-theme\.js\?v=neo-dashboard-20260825b\"><\/script>/);
  assert.match(source, /<script defer src=\"\/neo-home-polish\.js\?v=home-polish-20260825b\"><\/script>/);
  assert.match(source, /replace\('<\/head>'/);
  assert.doesNotMatch(source, /replace\('<\/body>'/);
});

test('app shell disables stale HTML caching', () => {
  assert.match(source, /no-cache, max-age=0, must-revalidate/);
});
