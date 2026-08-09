const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Content Studio prefers stable asset preview URLs and handles missing result assets', () => {
  const ui = fs.readFileSync('public/content-studio.js', 'utf8');
  const service = fs.readFileSync('src/services/contentStudio.js', 'utf8');

  assert.match(ui, /asset\.preview_url\|\|asset\.url/);
  assert.match(ui, /result_missing/);
  assert.match(ui, /File hasil tidak ditemukan/);

  assert.match(service, /generatedAssetIndex\(\)/);
  assert.match(service, /metadata\?\.generationId/);
  assert.match(service, /generatedAssetId/);
  assert.match(service, /RESULT_ASSET_MISSING/);
  assert.match(service, /\/api\/assets\/\$\{encodeURIComponent\(assetId\)\}\/preview/);
});
