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

// Foto persegi 1:1 (input standar user: 1536x1536, panel 2x2) harus MENGISI
// PENUH box 972x966 dengan margin 54/54/54 dan tanpa gap ungu di sisi
// (fit: cover). Ini geometry referensi #2.
test('foto persegi 1:1 mengisi penuh box 972x966 dengan margin 54/54/54 (referensi #2)', async () => {
  const dir = path.resolve(config.root, 'public/generated');
  const name = `__test_insert_${process.pid}_${Date.now()}.jpg`;
  const abs = path.join(dir, name);
  const rel = `/generated/${name}`;
  assert.ok(generatedPath(rel), 'path uji harus valid');

  await sharp({ create: { width: SLIDE_W, height: SLIDE_H, channels: 3, background: PURPLE } }).jpeg().toFile(abs);
  // sumber persegi 1536x1536 warna solid (mewakili panel 2x2 user)
  const square = await sharp({ create: { width: 1536, height: 1536, channels: 3, background: { r: 22, g: 160, b: 133 } } }).png().toBuffer();

  try {
    await overlaySlideOne(rel, square, resolveInsertBox(images, { contentLayout: 'news', slides: [{ title: 'Judul' }] }));
    const m = await detectPhotoMargins(abs);
    assert.ok(Math.abs(m.left - DEFAULT_IMAGE_LEFT) <= 6, `margin kiri ${m.left} != ~54`);
    assert.ok(Math.abs(m.right - DEFAULT_IMAGE_LEFT) <= 6, `margin kanan ${m.right} != ~54`);
    assert.ok(Math.abs(m.bottom - DEFAULT_IMAGE_LEFT) <= 6, `margin bawah ${m.bottom} != ~54`);
    assert.ok(Math.abs(m.left - m.right) <= 4, `kiri(${m.left}) & kanan(${m.right}) harus setara`);
    // cover => box terisi penuh: lebar ~972, tinggi ~966
    assert.ok(m.width >= DEFAULT_IMAGE_WIDTH - 8, `lebar foto ${m.width} harus penuh ~972`);
    assert.ok(m.height >= DEFAULT_IMAGE_HEIGHT - 8, `tinggi foto ${m.height} harus penuh ~966`);
  } finally {
    fs.rmSync(abs, { force: true });
  }
});

// Gambar potret / non-square tetap MENGISI PENUH box (cover, no gap), dan judul
// yang panjang TIDAK menekan/menggeser foto ke bawah (top tetap 900).
test('foto non-square mengisi penuh box & judul panjang tidak menggeser foto ke bawah', async () => {
  const dir = path.resolve(config.root, 'public/generated');
  const name = `__test_insert_portrait_${process.pid}_${Date.now()}.jpg`;
  const abs = path.join(dir, name);
  const rel = `/generated/${name}`;

  await sharp({ create: { width: SLIDE_W, height: SLIDE_H, channels: 3, background: PURPLE } }).jpeg().toFile(abs);
  // potret 1122x1402 (seperti asset produksi yang bikin gap sebelumnya)
  const portrait = await sharp({ create: { width: 1122, height: 1402, channels: 3, background: { r: 192, g: 57, b: 43 } } }).png().toBuffer();

  try {
    const longTitle = 'Belum Ada Perkembangan Terverifikasi tentang Kapal Virgo yang Sangat Panjang';
    await overlaySlideOne(rel, portrait, resolveInsertBox(images, { contentLayout: 'tutorial', slides: [{ title: longTitle }] }));
    const m = await detectPhotoMargins(abs);
    assert.ok(Math.abs(m.left - DEFAULT_IMAGE_LEFT) <= 6, `margin kiri ${m.left} != ~54`);
    assert.ok(Math.abs(m.right - DEFAULT_IMAGE_LEFT) <= 6, `margin kanan ${m.right} != ~54`);
    assert.ok(Math.abs(m.left - m.right) <= 4, `kiri(${m.left}) & kanan(${m.right}) harus setara`);
    assert.ok(m.width >= DEFAULT_IMAGE_WIDTH - 8, `lebar foto ${m.width} harus penuh ~972 (tanpa gap ungu)`);
    // judul panjang tidak boleh menggeser foto turun: top harus tetap di ~900
    assert.ok(Math.abs(m.top - DEFAULT_IMAGE_TOP) <= 6, `top foto ${m.top} harus tetap ~900 (judul tidak menekan)`);
  } finally {
    fs.rmSync(abs, { force: true });
  }
});
