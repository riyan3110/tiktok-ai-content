const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const images = require('../src/services/images');
const { resolveInsertBox, titleFitForInsert, TITLE_MAX_HEIGHT, overlaySlideOne, generatedPath } = require('../src/services/insertedImagePatch');
const config = require('../src/config');

const DEFAULT_IMAGE_WIDTH = 972;
const DEFAULT_IMAGE_HEIGHT = 966;
const DEFAULT_IMAGE_TOP = 900;
const DEFAULT_IMAGE_LEFT = 54;
const SLIDE_W = 1080;
const SLIDE_H = 1920;
const PURPLE = { r: 42, g: 10, b: 74 };

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

// Deteksi bounding-box area non-ungu (foto yang disisipkan) pada slide render.
async function detectPhotoMargins(jpgPath) {
  const { data, info } = await sharp(jpgPath).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const isPurple = (r, g, b) => Math.abs(r - PURPLE.r) < 26 && Math.abs(g - PURPLE.g) < 26 && Math.abs(b - PURPLE.b) < 30;
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch;
      if (!isPurple(data[i], data[i + 1], data[i + 2])) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return {
    left: minX,
    right: info.width - 1 - maxX,
    top: minY,
    bottom: info.height - 1 - maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

// Foto yang mengisi box penuh (persegi / wide berlatar solid) harus tampil di
// kotak 972x966 dengan margin kiri=kanan=bawah=54 (geometry referensi #2),
// dan tidak menyusut ke tengah dengan bawah yang terlalu lebar.
test('foto persegi mengisi box tetap 972x966 dengan margin 54/54/54 (referensi #2)', async () => {
  const dir = path.resolve(config.root, 'public/generated');
  const name = `__test_insert_${process.pid}_${Date.now()}.jpg`;
  const abs = path.join(dir, name);
  const rel = `/generated/${name}`;
  assert.ok(generatedPath(rel), 'path uji harus valid');

  // slide ungu penuh sebagai target
  await sharp({ create: { width: SLIDE_W, height: SLIDE_H, channels: 3, background: PURPLE } }).jpeg().toFile(abs);
  // sumber: gambar persegi full-bleed (isi box penuh)
  const square = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: { r: 22, g: 160, b: 133 } } }).png().toBuffer();

  try {
    await overlaySlideOne(rel, square, resolveInsertBox(images, { contentLayout: 'news', slides: [{ title: 'Judul' }] }));
    const m = await detectPhotoMargins(abs);
    // toleransi kecil untuk pembulatan + sudut membulat (rx=28)
    assert.ok(Math.abs(m.left - DEFAULT_IMAGE_LEFT) <= 6, `margin kiri ${m.left} != ~54`);
    assert.ok(Math.abs(m.right - DEFAULT_IMAGE_LEFT) <= 6, `margin kanan ${m.right} != ~54`);
    assert.ok(Math.abs(m.bottom - DEFAULT_IMAGE_LEFT) <= 6, `margin bawah ${m.bottom} != ~54`);
    assert.ok(Math.abs(m.left - m.right) <= 4, `kiri(${m.left}) & kanan(${m.right}) harus setara`);
    // foto harus mengisi hampir seluruh lebar box, bukan menyusut
    assert.ok(m.width >= DEFAULT_IMAGE_WIDTH - 12, `lebar foto ${m.width} terlalu kecil (harus ~972)`);
  } finally {
    fs.rmSync(abs, { force: true });
  }
});

// Gambar wide (16:9) berlatar solid: letterbox contain -> lebar penuh 972,
// margin kiri=kanan=54, dan tidak di-trim jadi mengapung di tengah.
test('foto wide 16:9 mengisi lebar penuh 972 dengan margin kiri=kanan (tidak menyusut)', async () => {
  const dir = path.resolve(config.root, 'public/generated');
  const name = `__test_insert_wide_${process.pid}_${Date.now()}.jpg`;
  const abs = path.join(dir, name);
  const rel = `/generated/${name}`;

  await sharp({ create: { width: SLIDE_W, height: SLIDE_H, channels: 3, background: PURPLE } }).jpeg().toFile(abs);
  const wide = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 192, g: 57, b: 43 } } }).png().toBuffer();

  try {
    await overlaySlideOne(rel, wide, resolveInsertBox(images, { contentLayout: 'tutorial', slides: [{ title: 'Judul panjang sekali untuk menguji' }] }));
    const m = await detectPhotoMargins(abs);
    assert.ok(Math.abs(m.left - DEFAULT_IMAGE_LEFT) <= 6, `margin kiri ${m.left} != ~54`);
    assert.ok(Math.abs(m.right - DEFAULT_IMAGE_LEFT) <= 6, `margin kanan ${m.right} != ~54`);
    assert.ok(Math.abs(m.left - m.right) <= 4, `kiri(${m.left}) & kanan(${m.right}) harus setara`);
    assert.ok(m.width >= DEFAULT_IMAGE_WIDTH - 12, `lebar foto ${m.width} harus mengisi penuh ~972`);
    // top foto tidak boleh di atas box (judul tidak menekan foto ke atas)
    assert.ok(m.top >= DEFAULT_IMAGE_TOP - 6, `foto atas ${m.top} naik di atas box top 900`);
  } finally {
    fs.rmSync(abs, { force: true });
  }
});
