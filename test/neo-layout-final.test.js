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
  assert.match(layout, /\.neo-profile-copy small[\s\S]*white-space:nowrap!important/);
  assert.match(layout, /\.neo-profile-copy strong[\s\S]*white-space:nowrap!important/);
});

test('mobile bottom navigation uses viewport insets and Create is vertically centered', () => {
  assert.match(layout, /\.neo-bottom-nav[\s\S]*left:12px!important/);
  assert.match(layout, /\.neo-bottom-nav[\s\S]*right:12px!important/);
  assert.match(layout, /\.neo-bottom-nav[\s\S]*width:auto!important/);
  assert.match(layout, /\.neo-bottom-nav[\s\S]*transform:none!important/);
  assert.match(layout, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) 58px minmax\(0,1fr\) minmax\(0,1fr\)!important/);
  assert.match(layout, /button\.neo-main[\s\S]*margin-top:0!important/);
  assert.match(layout, /button\.neo-main[\s\S]*transform:none!important/);
});

test('AI Providers route uses an explicit root class instead of :has viewport detection', () => {
  assert.match(layout, /function syncProviderRoute\(\)/);
  assert.match(layout, /root\.classList\.toggle\('aiads-provider-route', active\)/);
  assert.match(layout, /html\.aiads-provider-route main/);
  assert.match(layout, /html\.aiads-provider-route \.page-content/);
  assert.match(layout, /html\.aiads-provider-route #ai-providers \.provider-layout[\s\S]*display:block!important/);
  assert.doesNotMatch(layout, /html\.aiads-neo-theme:has\(#ai-providers/);
});

test('final layout layer loads after home polish', () => {
  const polishIndex = gateway.indexOf('/neo-home-polish.js');
  const finalIndex = gateway.indexOf('/neo-layout-final.js');
  assert.ok(polishIndex >= 0);
  assert.ok(finalIndex > polishIndex);
  assert.match(gateway, /neo-layout-final-20260826b/);
});
