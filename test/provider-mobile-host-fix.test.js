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

test('simple Provider UI stays in normal mobile page flow', () => {
  assert.match(script, /function simpleProviderActive\(\)/);
  assert.match(script, /providerActive\(\)\s*&&\s*!simpleProviderActive\(\)/);
  assert.match(script, /root\.classList\.remove\('aiads-provider-direct-host'\)/);
  assert.match(script, /anchor\.parentNode\.insertBefore\(provider, anchor\.nextSibling\)/);
});

test('simple Provider UI hides oversized fallback control', () => {
  assert.match(script, /#ai-providers #simple-provider-root \.simple-provider-fallback\s*\{[\s\S]*?display:none!important/);
});

test('legacy Provider host behavior remains available for non-simple UI', () => {
  assert.match(script, /shellMain\.insertBefore\(provider, pageContent\)/);
  assert.match(script, /root\.classList\.add\('aiads-provider-direct-host'\)/);
  assert.match(script, /html\.aiads-provider-direct-host body[\s\S]*overflow:hidden!important/);
  assert.match(script, /html\.aiads-provider-direct-host \.app-shell>main>#ai-providers[\s\S]*overflow-y:auto!important/);
});

test('provider observer reacts when simple UI mounts after startup', () => {
  assert.match(script, /childList:\s*true/);
  assert.match(script, /subtree:\s*true/);
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

test('Providers host fix loads after final layout layer', () => {
  const finalIndex = gateway.indexOf('/neo-layout-final.js');
  const hostIndex = gateway.indexOf('/provider-mobile-host-fix.js');
  assert.ok(finalIndex >= 0);
  assert.ok(hostIndex > finalIndex);
  assert.match(gateway, /provider-mobile-host-fix\.js\?v=\$\{CACHE_BUST_VERSION\}/);
});
