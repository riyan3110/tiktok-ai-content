const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'responsive-professional.css'), 'utf8');
const polish = fs.readFileSync(path.join(__dirname, '..', 'public', 'neo-home-polish.js'), 'utf8');
const gateway = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'siteAuthGateway.js'), 'utf8');

test('TikTok header uses one clear primary control', () => {
  assert.match(css, /\.neo-home-tiktok \.neo-tiktok-label/);
  assert.match(css, /\[data-tiktok-connect\],\.neo-home-tiktok \[data-tiktok-reconnect\],\.neo-home-tiktok \[data-tiktok-disconnect\]\{display:none!important\}/);
  assert.match(polish, /primary\.textContent = connected \? 'Connected'/);
  assert.match(polish, /primary\.setAttribute\('href', '\/auth\/tiktok'\)/);
  assert.match(polish, /label\.textContent = 'TikTok'/);
});

test('workspace title copy stays on one line when space allows', () => {
  assert.match(css, /\.neo-profile-copy small,\.neo-profile-copy strong\{white-space:nowrap!important/);
  assert.match(css, /\.neo-home-tiktok \.neo-tiktok-label\{[^}]*font-size:1rem!important;[^}]*font-weight:900!important/);
});

test('AI Providers follows the normal mobile content box without viewport breakout', () => {
  assert.match(css, /#ai-providers\{width:100%!important;max-width:100%!important;margin:0!important;padding:0!important\}/);
  assert.doesNotMatch(css, /#ai-providers\{width:calc\(100vw - 20px\)/);
  assert.doesNotMatch(css, /margin-left:calc\(50% - 50vw/);
  assert.match(css, /\.neo-bottom-nav\{[^}]*max-width:calc\(100vw - 24px\)!important/);
  assert.match(css, /#ai-providers \.provider-layout\{display:block!important;width:100%!important;max-width:100%!important/);
});

test('responsive stylesheet cache key is bumped', () => {
  assert.match(gateway, /responsive-professional\.css\?v=responsive-20260826c/);
  assert.match(gateway, /neo-home-polish\.js\?v=home-polish-20260826i/);
});
