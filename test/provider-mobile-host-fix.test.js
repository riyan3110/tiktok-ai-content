const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'public', 'provider-mobile-host-fix.js');
const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const gateway = fs.readFileSync(gatewayPath, 'utf8');

test('Providers host fix parses', () => {
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

test('Providers desktop and tablet keep professional full-width two-column layout', () => {
  assert.match(script, /@media\(min-width:768px\)[\s\S]*#ai-providers[\s\S]*width:100%!important/);
  assert.match(script, /grid-template-columns:minmax\(210px,260px\) minmax\(0,1fr\)!important/);
  assert.match(script, /@media\(min-width:1024px\)[\s\S]*grid-template-columns:260px minmax\(0,1fr\)!important/);
  assert.match(script, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
});

test('Create button has no vertical offset and sits at geometric center', () => {
  assert.match(script, /\.neo-bottom-nav>button\.neo-main[\s\S]*transform:translateY\(0\)!important/);
});

test('Providers host fix loads after final layout layer with current cache version', () => {
  const finalIndex = gateway.indexOf('/neo-layout-final.js');
  const hostIndex = gateway.indexOf('/provider-mobile-host-fix.js');
  assert.ok(finalIndex >= 0);
  assert.ok(hostIndex > finalIndex);
  assert.match(gateway, /provider-mobile-host-fix\.js\?v=provider-host-20260826b/);
});
