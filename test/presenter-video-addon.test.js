const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const addon = fs.readFileSync(path.join(root, 'public', 'presenter-video-addon.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'public', 'content-studio-vidu-models.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'public', 'legacy-carousel-addon.js'), 'utf8');

test('presenter video is an optional action layered onto Text Content', () => {
  assert.match(addon, /id = 'presenter-video-open'/);
  assert.match(addon, /🎬 Buat Video/);
  assert.match(addon, /\/api\/content-studio\/generate/);
  assert.match(addon, /assetIds: \[presenterAsset\.id\]/);
});

test('presenter video addon is loaded without replacing existing Text Content actions', () => {
  assert.match(loader, /presenter-video-addon\.js/);
  assert.match(index, /id="upload">Upload draft ke TikTok<\/button>/);
  assert.match(legacy, /shareButton\.id = 'share-carousel'/);
  assert.match(legacy, /Bagikan \+ salin caption/);
});

test('presenter flow requires an authorized presenter image before generation', () => {
  assert.match(addon, /presenter-video-rights/);
  assert.match(addon, /Konfirmasi hak penggunaan foto presenter/);
  assert.match(addon, /presenter tersebut adalah orang dewasa/);
});
