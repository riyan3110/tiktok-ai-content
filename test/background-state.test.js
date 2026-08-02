const test = require('node:test');
const assert = require('node:assert/strict');
const BackgroundState = require('../public/background-state');

const uploaded = { assetId: 'asset-1', previewUrl: '/api/assets/asset-1/preview', textColor: '#FFFFFF' };

test('upload → Putih → Upload memakai kembali asset yang sama tanpa upload kedua', () => {
  let state = BackgroundState.upload(BackgroundState.copy(), uploaded);
  state = BackgroundState.selectColor(state, '#FFFFFF');
  assert.deepEqual(state.uploadedBackground, uploaded);
  assert.equal(state.type, 'color');
  state = BackgroundState.activateUpload(state);
  assert.equal(state.type, 'image');
  assert.equal(state.assetId, uploaded.assetId);
  assert.equal(state.previewUrl, uploaded.previewUrl);
});

test('gambar upload tetap tersedia per slide dan bertahan setelah serialisasi reload', () => {
  let state = BackgroundState.upload(BackgroundState.copy(), uploaded);
  state = BackgroundState.selectColor(state, '#FFFFFF');
  state = BackgroundState.setSlide(state, 1, 'image');
  const reloaded = BackgroundState.copy(JSON.parse(JSON.stringify(state)));
  assert.equal(reloaded.type, 'color');
  assert.equal(reloaded.uploadedBackground.assetId, uploaded.assetId);
  assert.equal(reloaded.slideBackgrounds[1].type, 'image');
  assert.equal(reloaded.slideBackgrounds[1].assetId, uploaded.assetId);
});

test('Hapus membersihkan referensi upload sedangkan Reset hanya mengaktifkan Hitam', () => {
  let state = BackgroundState.upload(BackgroundState.copy(), uploaded);
  state = BackgroundState.setSlide(state, 1, 'image');
  const reset = BackgroundState.reset(state);
  assert.equal(reset.type, 'color');
  assert.equal(reset.color, '#0B0B0D');
  assert.equal(reset.uploadedBackground.assetId, uploaded.assetId);
  const removed = BackgroundState.removeUpload(state);
  assert.equal(removed.uploadedBackground, null);
  assert.equal(removed.type, 'color');
  assert.equal(removed.color, '#0B0B0D');
  assert.deepEqual(removed.slideBackgrounds, {});
});

test('draft image dari versi sebelumnya dimigrasikan ke uploadedBackground', () => {
  const state = BackgroundState.copy({ type: 'image', color: '#0B0B0D', ...uploaded, slideBackgrounds: {} });
  assert.deepEqual(state.uploadedBackground, uploaded);
});
