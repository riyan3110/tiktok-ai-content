const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../src/config');
const images = require('../src/services/images');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const request = require('supertest');

const content = { hook: 'Hook', body: '1. Langkah', topic: 'Topik', cta: 'Coba' };

test('slide dirender sebagai JPEG RGB/sRGB 1080 x 1920 dengan ekstensi jpg', async (t) => {
  const id = `test-${process.pid}-${Date.now()}`;
  const files = await images.createSlides(id, content);
  t.after(async () => Promise.all(files.map((file) => fs.rm(path.join(config.root, 'public', file), { force: true }))));

  assert.equal(files.length, 3);
  assert.ok(files.every((file) => file.endsWith('.jpg')));
  for (const file of files) {
    const metadata = await sharp(path.join(config.root, 'public', file)).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1920);
    assert.equal(metadata.space, 'srgb');
    assert.equal(metadata.channels, 3);
    assert.equal(metadata.hasAlpha, false);
  }
  await images.validateSlides(files);

  const db = createDatabase(':memory:');
  const app = createApp({ db });
  await request(app).get(files[0]).expect(200).expect('Content-Type', /^image\/jpeg/);
  db.close();
});

test('validasi menolak PNG lama dengan pesan bahasa Indonesia', async () => {
  await assert.rejects(images.validateSlides(['/generated/slide-lama.png']), /bukan file JPG yang valid/);
});

test('wrapping menggunakan lebar piksel dan mempertahankan teks pendek', () => {
  assert.deepEqual(images.wrapText('Teks pendek', 770, 46), ['Teks pendek']);
  assert.ok(images.measureTextWidth('MMMM', 46) > images.measureTextWidth('iiii', 46));
  assert.ok(images.wrapText('Strategi konten sedang yang perlu dibungkus dengan rapi', 360, 46).length > 1);
});

test('judul sedang auto-fit maksimal tiga baris di dalam safe area', () => {
  const fit = images.autoFitText(
    'Cara membuat iklan TikTok yang menarik perhatian audiens dalam beberapa detik',
    { maxWidth: 770, maxHeight: 520, maxLines: 3, startSize: 72, minSize: 52, lineHeight: 1.15 }
  );
  assert.ok(fit);
  assert.ok(fit.fontSize >= 52 && fit.fontSize <= 72);
  assert.ok(fit.lines.length <= 3);
  assert.ok(fit.lines.every((line) => images.measureTextWidth(line, fit.fontSize, true) <= 770));
});

test('teks sangat panjang dibagi menjadi slide tambahan tanpa dipotong', () => {
  const steps = Array.from({ length: 12 }, (_, index) => `${index + 1}. Lakukan langkah penting nomor ${index + 1} secara konsisten untuk memperoleh hasil terbaik`).join('\n');
  const layouts = images.buildSlideLayouts({
    hook: Array(30).fill('Judul sangat panjang').join(' '),
    body: steps,
    topic: 'Strategi pemasaran digital untuk usaha kecil',
    cta: Array(40).fill('Simpan dan praktikkan panduan ini').join(' ')
  });
  const stepSlides = layouts.filter(({ type }) => type === 'steps');
  const ctaSlides = layouts.filter(({ type }) => type === 'cta');
  assert.ok(layouts.filter(({ type }) => type === 'hook').length > 1);
  assert.equal(stepSlides.length, 3);
  assert.ok(stepSlides.every(({ fit }) => fit.steps.length <= 5 && fit.fontSize >= 34));
  assert.ok(ctaSlides.length > 1);
  assert.ok(ctaSlides.every(({ fit }) => fit.lines.length <= 4 && fit.height <= 1480 * 0.6));
});

test('format fakta singkat membuat satu fakta utama per slide isi', () => {
  const layouts = images.buildSlideLayouts({
    hook: 'Tiga fakta menarik',
    body: '- Fakta pertama\n- Fakta kedua\n- Fakta ketiga',
    topic: 'Fakta alam',
    cta: 'Simpan',
    contentFormat: 'Fakta singkat'
  });
  const facts = layouts.filter(({ type }) => type === 'steps');
  assert.equal(facts.length, 3);
  assert.ok(facts.every(({ title, fit }) => title === 'FAKTA UTAMA' && fit.steps.length === 1));
});
