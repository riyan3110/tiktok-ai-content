const test = require('node:test');
const assert = require('node:assert/strict');
const composer = require('../src/services/textInputComposer');
const images = require('../src/services/images');

const source = 'Perusahaan AI menyiapkan perubahan untuk model yang didukung. Perubahan membantu proses identifikasi tanpa mengubah tampilan teks bagi pengguna. Penerapan dilakukan secara bertahap sesuai dukungan model. Informasi tersebut menjadi dasar seluruh carousel.';

function sample() {
  return {
    topic: 'Perubahan untuk Model AI',
    caption: 'Perusahaan AI menyiapkan perubahan untuk model yang didukung. Perubahan ini membantu proses identifikasi tanpa mengubah tampilan teks, sementara penerapannya dilakukan secara bertahap sesuai dukungan model yang tersedia.',
    hashtags: ['#AI', '#Teknologi', '#ModelAI'],
    slides: [
      { section: 'HOOK', title: 'Perubahan Baru Mulai Disiapkan untuk Model AI', body: '', points: [] },
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
  const layouts = images.buildSlideLayouts(content);
  assert.equal(layouts.length, 4);
  assert.equal(layouts[0].isOnlyTitle, true);
});

test('caption is kept short enough to leave room for hashtags', () => {
  const value = sample();
  assert.equal(value.caption.split(/\s+/).length, 27);
  assert.deepEqual(composer.validateResult(value, source).errors, []);

  value.caption = Array.from({ length: 41 }, () => 'kata').join(' ');
  assert.ok(composer.validateResult(value, source).errors.some(error => /caption harus ringkas 25–40 kata/i.test(error)));
});

test('generate from text requires three to five hashtags', () => {
  const value = sample();
  value.hashtags = ['#AI', '#Teknologi'];
  assert.ok(composer.validateResult(value, source).errors.some(error => /hashtag harus 3–5 item/i.test(error)));

  assert.deepEqual(composer.normalizeHashtags(['AI', '#Teknologi', ' #ModelAI ', '#AI']), ['#AI', '#Teknologi', '#ModelAI']);
});

test('ungrounded editorial modifiers are rejected', () => {
  const value = sample();
  value.slides[3].body = 'Perubahan membantu identifikasi secara efektif tanpa mengubah tampilan teks, sementara penerapan tetap mengikuti dukungan model yang tersedia.';
  assert.ok(composer.validateResult(value, source).errors.some(error => /kata atau penegasan baru.*efektif/i.test(error)));
});

test('unsupported emphasis and attribution are rejected', () => {
  const value = sample();
  value.slides[3].title = 'Perubahan Menjadi Kunci Persaingan';
  value.slides[3].body = 'Perusahaan AI menegaskan perubahan ini meningkatkan produktivitas pengguna dan menjadi kunci baru bagi persaingan model saat ini.';
  const extra = composer.validateGroundedModifiers(value, source);
  assert.ok(extra.includes('kunci'));
  assert.ok(extra.includes('menegaskan'));
  assert.ok(extra.includes('produktivitas'));
});

test('seven slides are reduced to four while keeping hook and closing', () => {
  const value = sample();
  const extra = { section: 'DETAIL', title: 'Konteks Tambahan', body: 'Informasi tambahan tetap berasal dari teks input yang sama.', points: [] };
  const shaped = composer.shapeSlides([value.slides[0], value.slides[1], value.slides[2], extra, extra, extra, value.slides[3]], 4);
  assert.equal(shaped.length, 4);
  assert.equal(shaped[0].section, 'HOOK');
  assert.equal(shaped.at(-1).section, 'PENUTUP');
});

test('hook is title-only and requires a dense title', () => {
  const value = sample();
  value.slides[0].body = 'Body dari provider harus dibuang sebelum validasi dan render.';
  value.slides[0].points = ['Bullet juga harus dibuang'];
  const checked = composer.validateResult(value, source);
  assert.equal(checked.slides[0].body, '');
  assert.deepEqual(checked.slides[0].points, []);
  assert.equal(checked.errors.some(error => /slide 1.*body|slide 1.*bullet/i.test(error)), false);

  value.slides[0].title = 'Perubahan Baru';
  assert.ok(composer.validateResult(value, source).errors.some(error => /judul hook harus padat 7–10 kata/i.test(error)));
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

test('section labels cannot be reused as large slide titles', () => {
  const examples = [
    [1, 'Fakta Utama'],
    [2, 'Detail Penting'],
    [3, 'Kesimpulan']
  ];

  for (const [index, title] of examples) {
    const value = sample();
    value.slides[index].title = title;
    assert.ok(
      composer.validateResult(value, source).errors.some(error => /judul besar harus spesifik/i.test(error)),
      `${title} should be rejected as a large title`
    );
  }

  assert.equal(composer.genericSlideTitle('Ultrafast hingga 14x lebih cepat'), false);
});
