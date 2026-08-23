const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const config = require('../src/config');
const { slideFile, generatedAssetId } = require('../src/services/presenterVideoPatch');

test('slideFile accepts only generated slide image paths', () => {
  const result = slideFile('/generated/123-1.jpg');
  assert.equal(result, path.resolve(config.root, 'public/generated/123-1.jpg'));
  assert.throws(() => slideFile('/assets/private.jpg'), /Path slide tidak valid/);
  assert.throws(() => slideFile('/generated/../secret.jpg'), /Path slide tidak valid/);
});

test('generatedAssetId prefers stable generated asset metadata', () => {
  assert.equal(generatedAssetId({
    metadata: JSON.stringify({ generatedAssetId: 'asset-stable' }),
    media: JSON.stringify([{ assetId: 'asset-media' }])
  }), 'asset-stable');
  assert.equal(generatedAssetId({
    metadata: '{}',
    media: JSON.stringify([{ assetId: 'asset-media' }])
  }), 'asset-media');
});
