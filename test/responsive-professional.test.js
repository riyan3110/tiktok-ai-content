const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'responsive-professional.css'), 'utf8');
const gateway = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js'), 'utf8');

test('TikTok header controls have a clear TikTok label and short button labels', () => {
  assert.match(css, /\.neo-home-tiktok::before\{content:'TikTok'/);
  assert.match(css, /\[data-tiktok-connect\]::after,.+\[data-tiktok-reconnect\]::after\{content:'Connect'/);
  assert.match(css, /\[data-tiktok-disconnect\]::after\{content:'Disconnect'/);
});

test('AI Providers breaks out of legacy narrow mobile containers', () => {
  assert.match(css, /#ai-providers\{width:calc\(100vw - 20px\)!important;max-width:calc\(100vw - 20px\)!important/);
  assert.match(css, /margin-left:calc\(50% - 50vw \+ 10px\)!important/);
  assert.match(css, /#ai-providers \.provider-layout\{display:block!important;width:100%!important;max-width:100%!important/);
});

test('responsive stylesheet cache key is bumped', () => {
  assert.match(gateway, /responsive-professional\.css\?v=responsive-20260825b/);
});
