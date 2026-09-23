const test = require('node:test');
const assert = require('node:assert/strict');

const images = require('../src/services/images');
const { resolveInsertBox, titleFitForInsert, TITLE_MAX_HEIGHT } = require('../src/services/insertedImagePatch');

const DEFAULT_IMAGE_WIDTH = 972;
const DEFAULT_IMAGE_HEIGHT = 966;
const DEFAULT_IMAGE_TOP = 900;
const DEFAULT_IMAGE_LEFT = 54;

for (const contentLayout of ['tutorial', 'story', 'news']) {
  test(`slide-1 ${contentLayout} mempertahankan geometry gambar Default dan tidak menggeser gambar karena judul`, () => {
    const title = contentLayout === 'tutorial'
      ? 'Hubungkan Server ke GitLab Menggunakan SSH Tanpa Password Berulang'
      : contentLayout === 'story'
        ? 'Kalau hasilnya gagal, apa yang sebenarnya masih kita punya?'
        : 'Belum Ada Kabar Terverifikasi tentang Kapal Virgo';
    const box = resolveInsertBox(images, {
      contentLayout,
      slides: [{ title }]
    });
    const titleFit = titleFitForInsert(images, {
      contentLayout,
      slides: [{ title }]
    });

    assert.equal(box.left, DEFAULT_IMAGE_LEFT);
    assert.equal(box.top, DEFAULT_IMAGE_TOP);
    assert.equal(box.width, DEFAULT_IMAGE_WIDTH);
    assert.equal(box.height, DEFAULT_IMAGE_HEIGHT);
    assert.ok(titleFit);
    assert.ok(titleFit.lines.length <= 3);
    assert.ok(titleFit.height <= TITLE_MAX_HEIGHT);
  });
}

test('semua layout memakai ukuran dan posisi gambar Default, termasuk Default sendiri', () => {
  for (const contentLayout of ['default', 'tutorial', 'story', 'news']) {
    const box = resolveInsertBox(images, {
      contentLayout,
      slides: [{ title: 'Judul singkat' }]
    });
    assert.equal(box.left, DEFAULT_IMAGE_LEFT);
    assert.equal(box.top, DEFAULT_IMAGE_TOP);
    assert.equal(box.width, DEFAULT_IMAGE_WIDTH);
    assert.equal(box.height, DEFAULT_IMAGE_HEIGHT);
  }
});

test('tanpa title render_source, posisi fallback tetap sama seperti Default', () => {
  const box = resolveInsertBox(images, {});
  assert.equal(box.left, DEFAULT_IMAGE_LEFT);
  assert.equal(box.top, DEFAULT_IMAGE_TOP);
  assert.equal(box.width, DEFAULT_IMAGE_WIDTH);
  assert.equal(box.height, DEFAULT_IMAGE_HEIGHT);
});
