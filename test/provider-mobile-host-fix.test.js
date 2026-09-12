const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'public', 'provider-mobile-host-fix.js');
const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const gateway = fs.readFileSync(gatewayPath, 'utf8');

test('Providers mobile flow fix parses', () => {
  assert.doesNotThrow(() => new Function(script));
});

test('mobile Providers stays in normal page-content flow instead of a detached host', () => {
  assert.match(script, /provider\.parentElement !== pageContent/);
  assert.match(script, /pageContent\.insertBefore\(provider, generationQueue \|\| null\)/);
  assert.match(script, /root\.classList\.remove\('aiads-provider-direct-host'\)/);
  assert.match(script, /root\.classList\.toggle\('aiads-provider-page-flow', mobile && active\)/);
  assert.doesNotMatch(script, /shellMain\.insertBefore\(provider, pageContent\)/);
  assert.doesNotMatch(script, /ai-providers-original-position/);
});

test('mobile Providers uses document touch scrolling and never hides page-content', () => {
  assert.match(script, /html\.aiads-provider-page-flow body[\s\S]*overflow-y:auto!important/);
  assert.match(script, /html\.aiads-provider-page-flow body[\s\S]*touch-action:pan-y!important/);
  assert.match(script, /html\.aiads-provider-page-flow \.app-shell>main>\.page-content[\s\S]*display:block!important[\s\S]*overflow:visible!important/);
  assert.match(script, /html\.aiads-provider-page-flow #ai-providers[\s\S]*position:static!important[\s\S]*overflow:visible!important/);
  assert.doesNotMatch(script, /html\.aiads-provider-direct-host body\{\s*overflow:hidden!important/);
  assert.doesNotMatch(script, /\.app-shell>main>\.page-content\{\s*display:none!important/);
});

test('Providers route no longer waits a frame before changing mobile layout', () => {
  assert.match(script, /Apply the correct flow immediately/);
  assert.doesNotMatch(script, /requestAnimationFrame\(sync\)/);
});

test('Providers desktop and tablet keep professional full-width two-column layout', () => {
  assert.match(script, /@media\(min-width:768px\)[\s\S]*#ai-providers[\s\S]*width:100%!important/);
  assert.match(script, /grid-template-columns:minmax\(210px,260px\) minmax\(0,1fr\)!important/);
  assert.match(script, /@media\(min-width:1024px\)[\s\S]*grid-template-columns:260px minmax\(0,1fr\)!important/);
  assert.match(script, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
});

test('Create button stays mathematically centered in bottom navigation', () => {
  assert.match(script, /button\.neo-main[\s\S]*position:absolute!important/);
  assert.match(script, /button\.neo-main[\s\S]*left:50%!important/);
  assert.match(script, /button\.neo-main[\s\S]*top:50%!important/);
  assert.match(script, /button\.neo-main[\s\S]*transform:translate\(-50%,-50%\)!important/);
});

test('Providers flow fix still loads after the final layout layer', () => {
  const finalIndex = gateway.indexOf('/neo-layout-final.js');
  const hostIndex = gateway.indexOf('/provider-mobile-host-fix.js');
  assert.ok(finalIndex >= 0);
  assert.ok(hostIndex > finalIndex);
  assert.match(gateway, /providerMobileHostFixScript/);
});
