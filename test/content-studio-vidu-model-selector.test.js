const test = require('node:test');
const assert = require('node:assert/strict');
const vidu = require('../public/content-studio-vidu-models');

const dropdown = (media,assetCount,saved,configured) => vidu.stateFor({ media, assetCount, saved, configured });

test('Image dropdown follows reference2image eligibility', () => {
  assert.deepEqual(dropdown('image', 0), { models: ['viduq2'], choice: 'viduq2', valid: true, message: '' });
  assert.deepEqual(dropdown('image', 1).models, ['viduq2', 'viduq1']);
  assert.equal(dropdown('image', 1, 'viduq1').choice, 'viduq1');
});

test('Video dropdown follows text2video, img2video, and reference2video endpoints', () => {
  assert.deepEqual(dropdown('video', 0).models, ['viduq3-turbo','viduq3-pro','viduq2','viduq1']);
  assert.deepEqual(dropdown('video', 1).models, ['viduq3-pro-fast','viduq3-turbo','viduq3-pro','viduq2-pro-fast','viduq2-pro','viduq2-turbo','viduq1','viduq1-classic']);
  assert.deepEqual(dropdown('video', 2).models, ['viduq3-turbo','viduq3','viduq2','viduq1']);
  assert.equal(dropdown('video', 0).choice, 'viduq3-turbo');
});

test('adding and removing assets updates options without retaining an invalid model', () => {
  const noAsset = dropdown('video', 0, 'viduq3-pro');
  const oneAsset = dropdown('video', 1, noAsset.choice);
  const twoAssets = dropdown('video', 2, 'viduq3-pro-fast');
  const removed = dropdown('video', 0, twoAssets.choice);
  assert.equal(oneAsset.choice, 'viduq3-pro');
  assert.equal(twoAssets.choice, 'viduq3-turbo');
  assert.equal(removed.choice, 'viduq3-turbo');
});

test('more than seven references leaves no selectable model and blocks generation', () => {
  const state = dropdown('image', 8, 'viduq2');
  assert.deepEqual(state.models, []);
  assert.equal(state.choice, '');
  assert.equal(state.valid, false);
  assert.match(state.message, /maksimal 7 gambar/);
  assert.equal(vidu.validate('video', 8, 'viduq3-turbo').valid, false);
});

test('invalid and reference-only image models cannot be submitted', () => {
  assert.deepEqual(vidu.validate('image', 0, 'viduq1'), { valid: false, message: 'Model viduq1 Image memerlukan setidaknya satu gambar referensi.' });
  assert.equal(vidu.validate('video', 1, 'viduq3').valid, false);
  assert.equal(vidu.validate('video', 1, 'viduq3-pro-fast').valid, true);
});
