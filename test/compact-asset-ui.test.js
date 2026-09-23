const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('asset manager loads compact stylesheet', () => {
  const source = fs.readFileSync(path.join(root, 'public/assets.js'), 'utf8');
  assert.match(source, /asset-compact\.css\?v=1/);
  assert.match(source, /data-asset-compact|dataset\.assetCompact/);
});

test('main asset library removes visible folder rail and uses uniform square tiles like the picker (reference #5)', () => {
  const css = fs.readFileSync(path.join(root, 'public/asset-compact.css'), 'utf8');
  assert.match(css, /#asset-manager \.asset-layout>aside\s*\{[^}]*display:none!important/s);
  assert.match(css, /#asset-manager \.asset-layout\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/s);
  // Mobile: same 4-across square grid as the asset selector.
  assert.match(css, /#asset-manager \.asset-grid\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/s);
  // Cards are pure square image tiles with the meta caption hidden on the grid.
  assert.match(css, /#asset-manager \.asset-card\s*\{[^}]*aspect-ratio:1/s);
  assert.match(css, /#asset-manager \.asset-card-meta\s*\{\s*display:none!important/s);
});

test('asset selector is denser on mobile without changing selection behavior', () => {
  const css = fs.readFileSync(path.join(root, 'public/asset-compact.css'), 'utf8');
  assert.match(css, /\.asset-selector-grid\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.asset-selector-toolbar\s*\{[^}]*gap:6px/s);
  assert.match(css, /\.asset-selector-actions>div\s*\{[^}]*grid-template-columns:1fr 1\.35fr/s);
});
