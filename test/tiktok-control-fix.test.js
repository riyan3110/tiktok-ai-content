const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'public', 'tiktok-control-fix.js');
const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const gateway = fs.readFileSync(gatewayPath, 'utf8');

test('TikTok control fix parses', () => {
  assert.doesNotThrow(() => new Function(script));
});

test('single TikTok primary delegates to the real connection actions', () => {
  assert.match(script, /\[data-tiktok-primary\]/);
  assert.match(script, /\[data-tiktok-disconnect\]/);
  assert.match(script, /\[data-tiktok-connect\]/);
  assert.match(script, /\[data-tiktok-reconnect\]/);
  assert.match(script, /disconnect[^\n]*\.click\(\)/);
  assert.match(script, /connect\.click\(\)/);
  assert.match(script, /window\.location\.assign\('\/auth\/tiktok'\)/);
});

test('Connected control remains clickable while loading states are blocked', () => {
  assert.match(script, /neo-tiktok-primary\.connected[\s\S]*pointer-events:auto!important/);
  assert.match(script, /data-tiktok-busy="true"[\s\S]*pointer-events:none!important/);
  assert.match(script, /const busy = state === 'connecting' \|\| state === 'loading'/);
  assert.match(script, /primary\.dataset\.tiktokBusy = String\(busy\)/);
});

test('TikTok control fix loads after the home polish layer', () => {
  const polishIndex = gateway.indexOf('/neo-home-polish.js');
  const fixIndex = gateway.indexOf('/tiktok-control-fix.js');
  assert.ok(polishIndex >= 0);
  assert.ok(fixIndex > polishIndex);
  assert.match(gateway, /tiktok-control-fix\.js\?v=tiktok-control-20260826a/);
});
