const test = require('node:test');
const assert = require('node:assert/strict');
const composer = require('../src/services/textInputComposer');

test('shared product/model names between title and body are not treated as duplicate copy', () => {
  const slide = {
    section: 'HOOK',
    title: 'Ultrafast: Kecepatan Baru GPT-5.6 Sol',
    body: 'OpenAI meluncurkan mode Ultrafast untuk GPT-5.6 Sol, membuat tugas kompleks terasa jauh lebih cepat bagi pengguna.',
    points: []
  };

  assert.equal(composer.duplicateSlideCopy(slide), false);
});

test('exact or embedded repeated copy is still rejected', () => {
  assert.equal(composer.duplicateSlideCopy({
    title: 'Tampilan Teks Tetap Sama',
    body: 'Pengguna tetap membaca teks seperti biasa.',
    points: ['Tampilan Teks Tetap Sama']
  }), true);

  assert.equal(composer.duplicateSlideCopy({
    title: 'Penerapan Dilakukan Bertahap',
    body: 'Penerapan dilakukan bertahap sesuai dukungan model yang tersedia.',
    points: []
  }), true);
});
