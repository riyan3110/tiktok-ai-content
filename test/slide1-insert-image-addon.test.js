const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const addon = fs.readFileSync(path.join(__dirname, '../public/legacy-carousel-addon.js'), 'utf8');
const insertion = fs.readFileSync(path.join(__dirname, '../src/services/insertedImagePatch.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');

test('legacy carousel selector is repurposed as one optional inserted image, not an AI reference', () => {
  assert.match(addon, /heading\.textContent = 'Sisipkan gambar'/);
  assert.match(addon, /selectButton\.textContent = '□ Pilih gambar'/);
  assert.match(addon, /Belum ada gambar disisipkan/);
  assert.match(addon, /multiple:\s*false/);
  assert.match(addon, /delete body\.assetIds/);
  assert.match(addon, /\/contents\/\$\{encodeURIComponent\(generated\.id\)\}\/insert-image/);
});

test('selected image is composited only onto slide one below the hook area', () => {
  assert.match(insertion, /INSERT_BOX = Object\.freeze\(\{ left: 90, top: 1210, width: 740, height: 280 \}\)/);
  assert.match(insertion, /await overlaySlideOne\(files\[0\], file\.data\)/);
  assert.match(insertion, /await overlaySlideOne\(slides\[0\], file\.data\)/);
  assert.doesNotMatch(insertion, /overlaySlideOne\(files\[i\]/);
  assert.match(insertion, /renderSource\.insertedImageAssetId = assetId/);
});

test('compact TikTok copy is derived from real TikTok statuses', () => {
  assert.match(addon, /PROCESSING_DOWNLOAD: 'TikTok sedang memproses draft…'/);
  assert.match(addon, /SEND_TO_USER_INBOX: 'Draft sudah masuk ke TikTok ✅'/);
  assert.match(addon, /if \(status === 'FAILED'\)/);
  assert.match(addon, /statusNode\.dataset\.tiktokStatus = String\(data\?\.status \|\| ''\)/);
  assert.match(addon, /statusNode\.title = technicalStatus\(data\)/);
});

test('server mounts post-render insertion without replacing the existing generator', () => {
  assert.match(server, /installInsertedImagePatch\(\{ app, db, images \}\)/);
  assert.doesNotMatch(server, /generateAndSave\s*=/);
});
