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

test('mobile Providers and topbar are anchored to viewport edges rather than inherited width', () => {
  assert.match(script, /html\.aiads-provider-direct-host \.app-shell>main>\.topbar[\s\S]*position:fixed!important/);
  assert.match(script, /html\.aiads-provider-direct-host \.app-shell>main>\.topbar[\s\S]*left:0!important[\s\S]*right:0!important/);
  assert.match(script, /html\.aiads-provider-direct-host \.app-shell>main>#ai-providers[\s\S]*position:fixed!important/);
  assert.match(script, /html\.aiads-provider-direct-host \.app-shell>main>#ai-providers[\s\S]*left:0!important[\s\S]*right:0!important[\s\S]*bottom:0!important/);
  assert.match(script, /html\.aiads-provider-direct-host \.app-shell>main>\.page-content[\s\S]*display:none!important/);
  assert.doesNotMatch(script, /100dvw/);
});

test('Providers desktop and tablet keep professional full-width two-column layout', () => {
  assert.match(script, /@media\(min-width:768px\)[\s\S]*#ai-providers[\s\S]*width:100%!important/);
  assert.match(script, /grid-template-columns:minmax\(210px,260px\) minmax\(0,1fr\)!important/);
  assert.match(script, /@media\(min-width:1024px\)[\s\S]*grid-template-columns:260px minmax\(0,1fr\)!important/);
  assert.match(script, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
});

test('Create button is mathematically centered in bottom navigation', () => {
  assert.match(script, /button\.neo-main[\s\S]*position:absolute!important/);
  assert.match(script, /button\.neo-main[\s\S]*left:50%!important/);
  assert.match(script, /button\.neo-main[\s\S]*top:50%!important/);
  assert.match(script, /button\.neo-main[\s\S]*transform:translate\(-50%,-50%\)!important/);
});

test('Providers host fix loads after final layout layer with current cache version', () => {
  const finalIndex = gateway.indexOf('/neo-layout-final.js');
  const hostIndex = gateway.indexOf('/provider-mobile-host-fix.js');
  assert.ok(finalIndex >= 0);
  assert.ok(hostIndex > finalIndex);
  assert.match(gateway, /provider-mobile-host-fix\.js\?v=provider-host-20260826c/);
});
