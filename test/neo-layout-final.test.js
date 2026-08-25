const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const layoutPath = path.join(__dirname, '..', 'public', 'neo-layout-final.js');
const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const layout = fs.readFileSync(layoutPath, 'utf8');
const gateway = fs.readFileSync(gatewayPath, 'utf8');

test('final neo layout script parses', () => {
  assert.doesNotThrow(() => new Function(layout));
});

test('mobile workspace branding stays centered while TikTok status stays on the right', () => {
  assert.match(layout, /grid-template-columns:44px minmax\(0,1fr\) auto!important/);
  assert.match(layout, /\.neo-profile-avatar[\s\S]*transform:translateY\(3px\)!important/);
  assert.match(layout, /\.neo-profile-copy[\s\S]*transform:translateY\(3px\)!important/);
  assert.match(layout, /\.neo-status-cluster[\s\S]*grid-column:3!important/);
  assert.match(layout, /\.neo-status-cluster[\s\S]*justify-self:end!important/);
});

test('mobile bottom navigation is inset-bound and Create is geometrically centered', () => {
  assert.match(layout, /\.neo-bottom-nav[\s\S]*left:12px!important/);
  assert.match(layout, /\.neo-bottom-nav[\s\S]*right:12px!important/);
  assert.match(layout, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) 58px minmax\(0,1fr\) minmax\(0,1fr\)!important/);
  assert.match(layout, /button\.neo-main[\s\S]*margin:0!important/);
  assert.match(layout, /button\.neo-main[\s\S]*transform:translateY\(0\)!important/);
});

test('final layout no longer writes viewport widths inline for AI Providers', () => {
  assert.doesNotMatch(layout, /forceProviderShell/);
  assert.doesNotMatch(layout, /rememberSet/);
  assert.doesNotMatch(layout, /document\.documentElement\.clientWidth/);
  assert.doesNotMatch(layout, /aiads-provider-route/);
});

test('final layout layer loads after home polish with current cache version', () => {
  const polishIndex = gateway.indexOf('/neo-home-polish.js');
  const finalIndex = gateway.indexOf('/neo-layout-final.js');
  assert.ok(polishIndex >= 0);
  assert.ok(finalIndex > polishIndex);
  assert.match(gateway, /neo-layout-final-20260826d/);
});
