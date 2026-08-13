const test = require('node:test');
const assert = require('node:assert/strict');
const composer = require('../src/services/textInputComposer');
const images = require('../src/services/images');

const source = 'Perusahaan AI menyiapkan perubahan untuk model yang didukung. Perubahan membantu proses identifikasi tanpa mengubah tampilan teks bagi pengguna. Penerapan dilakukan secara bertahap sesuai dukungan model. Informasi tersebut menjadi dasar seluruh carousel.';

function sample() {
  return {
    topic: 'Perubahan untuk Model AI',
    caption: 'Perusahaan AI menyiapkan perubahan untuk model yang didukung. Perubahan membantu proses identifikasi tanpa mengubah tampilan teks bagi pengguna. Penerapannya dilakukan secara bertahap sesuai dukungan model. Carousel hanya merangkum informasi dari teks input tanpa menambahkan klaim baru dari luar bahan yang ditempel.',
    hashtags: ['#AI', '#Teknologi', '#ModelAI'],
    slides: [
      { section: 'HOOK', title: 'Hal Baru Mulai Disiapkan', body: 'Perusahaan AI menyiapkan perubahan untuk model yang didukung. Fitur ini membantu identifikasi tanpa mengubah tampilan teks pengguna.', points: [] },
      { section: 'FAKTA UTAMA', title: 'Fokus pada Dukungan Model', body: 'Penerapan mengikuti dukungan model yang tersedia secara bertahap.', points: ['Tampilan teks tetap sama', 'Identifikasi menjadi lebih terbantu'] },
      { section: 'DETAIL', title: 'Dampak bagi Pengguna', body: 'Pengguna tetap membaca teks dengan tampilan yang sama.', points: ['Perubahan tidak mengubah tampilan', 'Penerapan dilakukan secara bertahap'] },
      { section: 'PENUTUP', title: 'Garis Besarnya', body: 'Perubahan berfokus pada identifikasi dan tampilan teks, dengan penerapan yang tetap mengikuti dukungan model secara bertahap.', points: [] }
    ]
  };
}

test('four slides pass composer and stay four in renderer', () => {
  const value = sample();
  const checked = composer.validateResult(value, source);
  assert.deepEqual(checked.errors, []);
  const content = { ...composer.buildContent(value, checked.slides), contentCategory: 'Edukasi teknologi', contentFormat: 'Listicle' };
  assert.equal(images.buildSlideLayouts(content).length, 4);
});

test('seven slides are reduced to four while keeping hook and closing', () => {
  const value = sample();
  const extra = { section: 'DETAIL', title: 'Konteks Tambahan', body: 'Informasi tambahan tetap berasal dari teks input yang sama.', points: [] };
  const shaped = composer.shapeSlides([value.slides[0], value.slides[1], value.slides[2], extra, extra, extra, value.slides[3]], 4);
  assert.equal(shaped.length, 4);
  assert.equal(shaped[0].section, 'HOOK');
  assert.equal(shaped.at(-1).section, 'PENUTUP');
});

test('short hook body is rejected', () => {
  const value = sample();
  value.slides[0].body = 'Perubahan baru segera hadir.';
  assert.ok(composer.validateResult(value, source).errors.some(error => /slide 1 harus padat/i.test(error)));
});

test('same idea inside one slide is rejected', () => {
  const value = sample();
  value.slides[1].title = 'Tampilan Teks Tetap Sama';
  value.slides[1].points[0] = 'Tampilan teks tetap sama';
  assert.ok(composer.validateResult(value, source).errors.some(error => /informasi yang berbeda/i.test(error)));
});

test('new numbers are rejected', () => {
  const value = sample();
  value.slides[1].body = 'Penerapan difokuskan pada 99 model yang sudah didukung.';
  assert.ok(composer.validateResult(value, source).errors.some(error => /angka baru/i.test(error)));
});

test('ordinary summaries use four slides and very long text can use five', () => {
  assert.equal(composer.targetSlideCount(source), 4);
  assert.equal(composer.targetSlideCount(Array.from({ length: 230 }, (_, index) => `kata${index}`).join(' ')), 5);
});
