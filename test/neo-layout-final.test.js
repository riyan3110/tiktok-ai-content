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
  assert.match(layout, /grid-template-columns:44px minmax\(105px,1fr\) auto!important/);
  assert.match(layout, /\.neo-profile-avatar[\s\S]*transform:translateY\(3px\)!important/);
  assert.match(layout, /\.neo-profile-copy[\s\S]*transform:translateY\(3px\)!important/);
  assert.match(layout, /\.neo-status-cluster[\s\S]*grid-column:3!important/);
  assert.match(layout, /\.neo-status-cluster[\s\S]*justify-self:end!important/);
  assert.match(layout, /\.neo-profile-copy small[\s\S]*white-space:nowrap!important/);
  assert.match(layout, /\.neo-profile-copy strong[\s\S]*white-space:nowrap!important/);
});

test('mobile bottom navigation is viewport-bound and Create is centered', () => {
  assert.match(layout, /\.neo-bottom-nav[\s\S]*width:calc\(100dvw - 24px\)!important/);
  assert.match(layout, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) 58px minmax\(0,1fr\) minmax\(0,1fr\)!important/);
  assert.match(layout, /button\.neo-main[\s\S]*justify-self:center!important/);
  assert.match(layout, /button\.neo-main[\s\S]*transform:translateY\(-9px\)!important/);
});

test('AI Providers active route anchors the entire shell to the dynamic viewport', () => {
  assert.match(layout, /html\.aiads-neo-theme:has\(#ai-providers:not\(\.hidden\)\)/);
  assert.match(layout, /width:100dvw!important/);
  assert.match(layout, /\.topbar[\s\S]*width:100dvw!important/);
  assert.match(layout, /\.page-content[\s\S]*width:100dvw!important/);
  assert.match(layout, /#ai-providers \.provider-layout[\s\S]*display:block!important/);
});

test('final layout layer loads after home polish', () => {
  const polishIndex = gateway.indexOf('/neo-home-polish.js');
  const finalIndex = gateway.indexOf('/neo-layout-final.js');
  assert.ok(polishIndex >= 0);
  assert.ok(finalIndex > polishIndex);
  assert.match(gateway, /neo-layout-final-20260826a/);
});
