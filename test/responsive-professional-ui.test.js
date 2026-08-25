const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'responsive-professional.css'), 'utf8');

test('desktop shell fills viewport after permanent sidebar removal', () => {
  assert.match(css, /html\.aiads-neo-theme main\{[^}]*margin-left:0!important/);
  assert.match(css, /max-width:100vw!important/);
  assert.match(css, /max-width:1280px!important/);
  assert.match(css, /@media\(min-width:1024px\)/);
  assert.match(css, /\.neo-home-dashboard\{max-width:1180px!important/);
});

test('AI Providers cannot widen or zoom the mobile viewport', () => {
  assert.match(css, /#ai-providers\{overflow-x:clip!important/);
  assert.match(css, /#ai-providers input,[\s\S]*font-size:16px!important/);
  assert.match(css, /#ai-providers \.provider-layout\{display:block!important;min-height:0!important\}/);
  assert.match(css, /#ai-providers \.provider-detail\{padding:14px!important\}/);
  assert.match(css, /#ai-providers \.provider-form \.form-grid\{grid-template-columns:1fr!important\}/);
});

test('AI Providers has intentional tablet and desktop layouts', () => {
  assert.match(css, /@media\(min-width:768px\) and \(max-width:1023px\)/);
  assert.match(css, /grid-template-columns:210px minmax\(0,1fr\)!important/);
  assert.match(css, /grid-template-columns:260px minmax\(0,1fr\)!important/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
});

test('TikTok header controls stay beside READY and compact', () => {
  assert.match(css, /\.neo-status-cluster/);
  assert.match(css, /min-height:25px!important/);
  assert.match(css, /\.neo-profile-chip\[data-tiktok-state="connected"\]/);
  assert.match(css, /background:#c9f7d7!important/);
});
