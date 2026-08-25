const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'public', 'provider-mobile-host-fix.js');
const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const gateway = fs.readFileSync(gatewayPath, 'utf8');

test('mobile Providers host fix parses', () => {
  assert.doesNotThrow(() => new Function(script));
});

test('mobile Providers is moved outside page-content and restored after navigation', () => {
  assert.match(script, /ai-providers-original-position/);
  assert.match(script, /shellMain\.insertBefore\(provider, pageContent\)/);
  assert.match(script, /anchor\.parentNode\.insertBefore\(provider, anchor\.nextSibling\)/);
  assert.match(script, /root\.classList\.add\('aiads-provider-direct-host'\)/);
  assert.match(script, /root\.classList\.remove\('aiads-provider-direct-host'\)/);
});

test('direct Providers host bypasses page-content width on mobile', () => {
  assert.match(script, /html\.aiads-provider-direct-host \.app-shell>main>\.page-content[\s\S]*display:none!important/);
  assert.match(script, /html\.aiads-provider-direct-host \.app-shell>main>#ai-providers[\s\S]*width:100%!important/);
  assert.match(script, /html\.aiads-provider-direct-host \.app-shell>main>#ai-providers[\s\S]*max-width:none!important/);
});

test('Create button uses midpoint offset between prior high and low positions', () => {
  assert.match(script, /\.neo-bottom-nav>button\.neo-main[\s\S]*transform:translateY\(2px\)!important/);
});

test('mobile Providers host fix loads after final layout layer', () => {
  const finalIndex = gateway.indexOf('/neo-layout-final.js');
  const hostIndex = gateway.indexOf('/provider-mobile-host-fix.js');
  assert.ok(finalIndex >= 0);
  assert.ok(hostIndex > finalIndex);
  assert.match(gateway, /provider-mobile-host-fix\.js\?v=provider-host-20260826a/);
});
