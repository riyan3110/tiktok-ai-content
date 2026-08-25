const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'public', 'provider-legal-fix.js');
const gatewayPath = path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const gateway = fs.readFileSync(gatewayPath, 'utf8');

test('Providers legal fix parses', () => {
  assert.doesNotThrow(() => new Function(script));
});

test('mobile Providers moves the real legal footer to the bottom of the scroll surface', () => {
  assert.match(script, /aiads-legal-footer-original-position/);
  assert.match(script, /provider\.appendChild\(footer\)/);
  assert.match(script, /footer\.classList\.add\('provider-legal-footer'\)/);
  assert.match(script, /#ai-providers>footer\.provider-legal-footer[\s\S]*position:static!important/);
  assert.match(script, /#ai-providers>footer\.provider-legal-footer[\s\S]*margin:32px 0 0!important/);
});

test('legal footer is restored when leaving mobile Providers', () => {
  assert.match(script, /footer\.classList\.remove\('provider-legal-footer'\)/);
  assert.match(script, /footerAnchor\.parentNode\.insertBefore\(footer, footerAnchor\.nextSibling\)/);
});

test('Providers legal fix loads after the direct mobile host fix', () => {
  const hostIndex = gateway.indexOf('/provider-mobile-host-fix.js');
  const legalIndex = gateway.indexOf('/provider-legal-fix.js');
  assert.ok(hostIndex >= 0);
  assert.ok(legalIndex > hostIndex);
  assert.match(gateway, /provider-legal-fix\.js\?v=provider-legal-20260826a/);
});
