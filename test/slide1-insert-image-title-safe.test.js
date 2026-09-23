const test = require('node:test');
const assert = require('node:assert/strict');

const images = require('../src/services/images');
const { resolveInsertBox, titleFitForInsert } = require('../src/services/insertedImagePatch');

const DEFAULT_IMAGE_WIDTH = 972;
const DEFAULT_IMAGE_HEIGHT = 966;

test('slide-1 tutorial menurunkan foto di bawah judul panjang tanpa mengecilkan ukuran gambar', () => {
  const title = 'Hubungkan Server ke GitLab Menggunakan SSH Tanpa Password Berulang';
  const box = resolveInsertBox(images, {
    contentLayout: 'tutorial',
    slides: [{ title }]
  });

  assert.ok(titleFitForInsert(images, { contentLayout: 'tutorial', slides: [{ title }] }).lines.length >= 3);
  assert.ok(box.top > 900);
  assert.equal(box.left, 54);
  assert.equal(box.width, DEFAULT_IMAGE_WIDTH);
  assert.equal(box.height, DEFAULT_IMAGE_HEIGHT);
});

test('slide-1 story dengan judul panjang tidak boleh menempel ke foto dan ukuran tetap seperti default', () => {
  const title = 'Kalau hasilnya gagal, apa yang sebenarnya masih kita punya?';
  const box = resolveInsertBox(images, {
    contentLayout: 'story',
    slides: [{ title }]
  });

  assert.ok(box.top > 900);
  assert.equal(box.width, DEFAULT_IMAGE_WIDTH);
  assert.equal(box.height, DEFAULT_IMAGE_HEIGHT);
});

test('semua layout memakai ukuran gambar Default dan margin horizontal yang sama', () => {
  const layouts = ['default', 'tutorial', 'story', 'news'];
  for (const contentLayout of layouts) {
    const box = resolveInsertBox(images, {
      contentLayout,
      slides: [{ title: 'Judul singkat' }]
    });
    assert.equal(box.left, 54);
    assert.equal(box.width, DEFAULT_IMAGE_WIDTH);
    assert.equal(box.height, DEFAULT_IMAGE_HEIGHT);
    assert.ok(box.top >= 900);
  }
});

test('tanpa title render_source, posisi fallback tetap 900px dengan ukuran Default', () => {
  const box = resolveInsertBox(images, {});
  assert.equal(box.top, 900);
  assert.equal(box.width, DEFAULT_IMAGE_WIDTH);
  assert.equal(box.height, DEFAULT_IMAGE_HEIGHT);
});
