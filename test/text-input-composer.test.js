const test = require('node:test');
const assert = require('node:assert/strict');
const composer = require('../src/services/textInputComposer');
const images = require('../src/services/images');

const source = 'Perusahaan AI menjelaskan fitur baru yang akan diterapkan pada model yang didukung. Fitur tersebut menjaga tampilan teks tetap sama dan membantu proses identifikasi. Penerapannya dilakukan secara bertahap sesuai dukungan model. Perusahaan menekankan bahwa perubahan ini berfokus pada proses identifikasi tanpa mengubah tampilan yang dibaca pengguna.';

function sample() {
  return {
    topic: 'Fitur Baru untuk Model AI',
    caption: 'Perusahaan AI menjelaskan fitur baru untuk model yang didukung. Perubahan ini ditujukan untuk membantu proses identifikasi tanpa mengubah tampilan teks yang dibaca pengguna. Penerapannya dilakukan secara bertahap sesuai dukungan model, sehingga isi carousel tetap mengikuti ringkasan yang ditempel pengguna dan tidak menambahkan informasi dari luar teks.',
    hashtags: ['#AI', '#Teknologi', '#ModelAI'],
    slides: [
      {
        section: 'HOOK',
        title: 'Perubahan Baru untuk Model AI',
        body: 'Perusahaan AI menyiapkan perubahan untuk model yang didukung. Tujuannya membantu proses identifikasi sambil menjaga tampilan teks tetap sama bagi pengguna.',
        points: []
      },
      {
        section: 'FAKTA UTAMA',
        title: 'Fokus pada Model Didukung',
        body: 'Penerapan mengikuti dukungan model yang tersedia secara bertahap.',
        points: ['Tampilan teks tetap sama', 'Membantu proses identifikasi']
      },
      {
        section: 'DETAIL',
        title: 'Pengguna Tetap Melihat Teks',
        body: 'Pengguna tetap melihat teks dengan tampilan yang sama.',
        points: ['Identifikasi tetap terbantu', 'Penerapan dilakukan bertahap']
      },
      {
        section: 'PENUTUP',
        title: 'Inti Perubahannya',
        body: 'Perubahan ini membantu identifikasi tanpa mengubah tampilan teks, sementara penerapannya mengikuti dukungan model secara bertahap sesuai penjelasan perusahaan.',
        points: []
      }
    ]
  };
}

test('required four-slide structure is accepted and renderer keeps four slides', () => {
  const value = sample();
  const checked = composer.validateResult(value, source);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.slides.length, 4);
  const content = {
    ...composer.buildContent(value, checked.slides),
    contentCategory: 'Edukasi teknologi',
    contentFormat: 'Listicle'
  };
  const layouts = images.buildSlideLayouts(content);
  assert.equal(layouts.length, 4);
});

test('slide one stays dense but inside renderer body limit', () => {
  const value = sample();
  value.slides[0].body = 'Fitur baru segera hadir.';
  assert.ok(composer.validateResult(value, source).errors.some(error => /slide 1 harus padat/i.test(error)));
});

test('seven model slides are deterministically reduced to requested four without inventing copy', () => {
  const value = sample();
  value.slides = [
    value.slides[0],
    value.slides[1],
    value.slides[2],
    { section: 'DETAIL', title: 'Tambahan Satu', body: 'Penerapan tetap mengikuti dukungan model yang tersedia secara bertahap.', points: [] },
    { section: 'DETAIL', title: 'Tambahan Dua', body: 'Tampilan teks tetap sama bagi pengguna selama perubahan diterapkan.', points: [] },
    { section: 'DETAIL', title: 'Tambahan Tiga', body: 'Proses identifikasi tetap menjadi bagian utama dari perubahan tersebut.', points: [] },
    value.slides[3]
  ];
  const shaped = composer.shapeSlides(value.slides, 4);
  assert.equal(shaped.length, 4);
  assert.equal(shaped[0].section, 'HOOK');
  assert.equal(shaped.at(-1).section, 'PENUTUP');
});

test('semantic repetition inside one slide is rejected before renderer', () => {
  const value = sample();
  value.slides[1].title = 'Tampilan Teks Tetap Sama';
  value.slides[1].points[0] = 'Tampilan teks tetap sama';
  assert.ok(composer.validateResult(value, source).errors.some(error => /informasi yang berbeda/i.test(error)));
});

test('numbers not present in input are rejected', () => {
  const value = sample();
  value.slides[1].body = 'Penerapan fitur difokuskan pada 99 model yang memang sudah didukung.';
  assert.ok(composer.validateResult(value, source).errors.some(error => /angka baru/i.test(error)));
});

test('long pasted text opts into five slides while ordinary summaries stay at four', () => {
  assert.equal(composer.targetSlideCount(source), 4);
  const longSource = Array.from({ length: 230 }, (_, index) => `kata${index}`).join(' ');
  assert.equal(composer.targetSlideCount(longSource), 5);
});
