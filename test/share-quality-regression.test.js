const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const images = fs.readFileSync(path.join(__dirname, '../src/services/images.js'), 'utf8');

test('carousel JPEG keeps 1080p output with high quality and full chroma detail', () => {
  assert.match(images, /const WIDTH = 1080;/);
  assert.match(images, /const HEIGHT = 1920;/);
  assert.match(images, /const JPEG_QUALITY = 98;/);
  assert.match(images, /\.jpeg\(\{ quality: JPEG_QUALITY, chromaSubsampling: '4:4:4' \}\)/);
  assert.doesNotMatch(images, /\.png\(\)\.toFile\(path\.join\(dir, name\)\)/);
});
