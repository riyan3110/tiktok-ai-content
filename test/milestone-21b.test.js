const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('semua surface memakai satu AssetManager dan factory tidak memiliki dialog lama', () => {
  const factory = fs.readFileSync('public/content-factory.js', 'utf8');
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.match(factory, /window\.AssetManager\.select/);
  assert.doesNotMatch(html, /factory-asset-dialog/);
  assert.equal((html.match(/id="asset-selector"/g) || []).length, 1);
});

test('picker mobile image-first tiga kolom, lazy, paginated, dan chip 48px', () => {
  const css = fs.readFileSync('public/style.css', 'utf8');
  const js = fs.readFileSync('public/assets.js', 'utf8');
  assert.match(css, /repeat\(3,minmax\(72px,80px\)\)/);
  assert.match(css, /\.selected-asset\{[^}]*width:48px;height:48px/);
  assert.match(js, /loading="lazy" decoding="async"/);
  assert.match(js, /PAGE_SIZE = 90/);
  assert.match(js, /touchstart/);
});
