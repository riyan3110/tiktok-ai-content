const test = require('node:test');
const assert = require('node:assert/strict');
const composer = require('../src/services/textInputComposer');

const source = 'Perusahaan AI menjelaskan fitur baru yang akan diterapkan pada model yang didukung. Fitur tersebut menjaga tampilan teks tetap sama dan membantu proses identifikasi. Penerapannya dilakukan secara bertahap sesuai dukungan model.';

function sample() {
  return {
    topic: 'Fitur Baru untuk Model AI',
    caption: 'Perusahaan AI menjelaskan fitur baru untuk model yang didukung. Fitur itu menjaga tampilan teks tetap sama dan membantu proses identifikasi. Penerapannya dilakukan secara bertahap sesuai dukungan model, sehingga seluruh carousel tetap mengikuti informasi dari ringkasan yang ditempel pengguna.',
    hashtags: ['#AI', '#Teknologi', '#ModelAI'],
    slides: [
      { section: 'HOOK', title: 'Fitur Baru Mulai Disiapkan', body: 'Perusahaan AI menjelaskan fitur baru yang akan diterapkan pada model yang didukung. Fitur ini menjaga tampilan teks tetap sama sekaligus membantu proses identifikasi pada penggunaan yang disebutkan.', points: [] },
      { section: 'FAKTA UTAMA', title: 'Fokus pada Model Didukung', body: 'Penerapan fitur difokuskan pada model yang memang sudah didukung.', points: ['Menjaga tampilan teks tetap sama', 'Membantu proses identifikasi konten'] },
      { section: 'DETAIL', title: 'Penerapan Tetap Bertahap', body: 'Perusahaan menyebut penerapan dilakukan secara bertahap mengikuti dukungan model.', points: ['Berlaku pada model yang didukung', 'Peluncuran dilakukan secara bertahap'] },
      { section: 'PENUTUP', title: 'Intinya Ada pada Dukungan', body: 'Fitur baru tersebut berfokus pada model yang didukung, mempertahankan tampilan teks, membantu identifikasi, dan diterapkan secara bertahap sesuai informasi yang diberikan.', points: [] }
    ]
  };
}

test('required slide structure is accepted', () => {
  const checked = composer.validateResult(sample(), source);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.slides.length, 4);
  assert.equal(checked.slides[1].points.length, 2);
  assert.equal(checked.slides[2].points.length, 2);
});

test('slide one must not be too short', () => {
  const value = sample();
  value.slides[0].body = 'Fitur baru segera hadir.';
  assert.ok(composer.validateResult(value, source).errors.some(error => /slide 1 harus cukup padat/i.test(error)));
});

test('numbers not present in input are rejected', () => {
  const value = sample();
  value.slides[1].body = 'Penerapan fitur difokuskan pada 99 model yang memang sudah didukung.';
  assert.ok(composer.validateResult(value, source).errors.some(error => /angka baru/i.test(error)));
});
