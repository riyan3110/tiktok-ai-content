const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const softFit = require('../src/services/textInputSoftFitPatch');
const verbatim = require('../src/services/textInputVerbatimPatch');
const autoSourcePatch = require('../src/services/autoSourcePatch');
const images = require('../src/services/images');
const composer = require('../src/services/textInputComposer');

const slides = [
  { section: 'HOOK', title: 'Kegagalan Bukan Akhir dari Semua Pilihan', body: '', points: [] },
  { section: 'FAKTA UTAMA', title: 'Masih Ada Ruang untuk Bergerak', body: 'Satu hasil buruk tidak menghapus semua tindakan yang masih bisa dilakukan.', points: ['Pilihan lain tetap terbuka', 'Perhatian bisa diarahkan ulang'] },
  { section: 'DETAIL', title: 'Bedakan Hasil dan Arah Berikutnya', body: 'Yang sudah terjadi tidak harus menentukan seluruh keputusan setelahnya.', points: ['Evaluasi bagian yang gagal', 'Rapikan langkah berikutnya'] },
  { section: 'PENUTUP', title: 'Jangan Serahkan Arah Hidup pada Satu Hasil', body: 'Kekalahan boleh terasa berat, tetapi keputusan berikutnya tetap bisa disusun kembali.', points: [] }
];

function content(layout) {
  return {
    verificationStatus: 'text_input_only',
    contentFormat: 'Tutorial langkah',
    contentLayout: layout,
    slides
  };
}

test('Generate dari Teks: Default tetap memakai layout lama tanpa label routing terlihat', () => {
  const layouts = softFit.buildTextInputLayouts(content('default'));
  assert.equal(layouts.length, 4);
  assert.ok(layouts.every(layout => layout.title === verbatim.INVISIBLE_SECTION));
  assert.match(layouts[1].content.points[0].text, /^• /);
});

test('Generate dari Teks: Tutorial menampilkan langkah dan numbering', () => {
  const layouts = softFit.buildTextInputLayouts(content('tutorial'));
  assert.deepEqual(layouts.map(layout => layout.title), ['PEMBUKA', 'LANGKAH 1', 'LANGKAH 2', 'HASIL/PENUTUP']);
  assert.match(layouts[1].content.points[0].text, /^1\. /);
  assert.match(layouts[1].content.points[1].text, /^2\. /);
});

test('Generate dari Teks: Cerita memakai alur cerita tanpa numbering tutorial', () => {
  const layouts = softFit.buildTextInputLayouts(content('story'));
  assert.deepEqual(layouts.map(layout => layout.title), ['PEMBUKA CERITA', 'SITUASI', 'PERKEMBANGAN', 'PENYELESAIAN']);
  assert.match(layouts[1].content.points[0].text, /^• /);
});

test('Generate dari Teks: Berita memakai headline, fakta, konteks, perkembangan', () => {
  const layouts = softFit.buildTextInputLayouts(content('news'));
  assert.deepEqual(layouts.map(layout => layout.title), ['HEADLINE', 'FAKTA UTAMA', 'KONTEKS/DETAIL', 'PERKEMBANGAN']);
  assert.match(layouts[2].content.points[0].text, /^• /);
});

test('text composer bridge meneruskan layout yang dipilih', async () => {
  let received;
  const composer = {
    compose: async args => {
      received = args;
      return { ok: true };
    }
  };
  const result = await autoSourcePatch.composeTextInputWithFreshRetry({
    text: 'copy',
    contentLayout: 'news',
    composer
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(received.contentLayout, 'news');
});

test('verbatim pasted content menyimpan contentLayout tanpa menulis ulang copy', async () => {
  const pasted = `SLIDE 1 - HOOK
Kegagalan Bukan Akhir dari Semua Pilihan
SLIDE 2 - FAKTA UTAMA
Masih Ada Ruang untuk Bergerak
Satu hasil buruk tidak menghapus semua tindakan yang masih bisa dilakukan.
• Pilihan lain tetap terbuka
• Perhatian bisa diarahkan ulang
SLIDE 3 - DETAIL
Bedakan Hasil dan Arah Berikutnya
Yang sudah terjadi tidak harus menentukan seluruh keputusan setelahnya.
• Evaluasi bagian yang gagal
• Rapikan langkah berikutnya
SLIDE 4 - PENUTUP
Jangan Serahkan Arah Hidup pada Satu Hasil
Kekalahan boleh terasa berat, tetapi keputusan berikutnya tetap bisa disusun kembali.`;

  const result = await verbatim.composeVerbatim({ text: pasted, contentLayout: 'story' });
  assert.equal(result.contentLayout, 'story');
  assert.equal(result.slides[0].title, 'Kegagalan Bukan Akhir dari Semua Pilihan');
});

test('UI menandai satu layout aktif dengan badge centang yang jelas', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'asset-compact.css'), 'utf8');
  assert.match(css, /#legacy-studio #layout-picker \.layout-option\.active::after/);
  assert.match(css, /content:"✓"/);
});


test('Tutorial, Cerita, dan Berita benar-benar memakai komposisi visual berbeda', () => {
  const tutorial = softFit.buildTextInputLayouts(content('tutorial'))[1];
  const story = softFit.buildTextInputLayouts(content('story'))[1];
  const news = softFit.buildTextInputLayouts(content('news'))[1];

  const tutorialSvg = images.renderLayout(tutorial, 2, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' });
  const storySvg = images.renderLayout(story, 2, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' });
  const newsSvg = images.renderLayout(news, 2, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' });

  assert.match(tutorialSvg, /data-layout="tutorial"/);
  assert.match(tutorialSvg, />TUTORIAL</);
  assert.match(storySvg, /data-layout="story"/);
  assert.match(storySvg, />CERITA</);
  assert.match(newsSvg, /data-layout="news"/);
  assert.match(newsSvg, />BERITA</);
  assert.notEqual(tutorialSvg, storySvg);
  assert.notEqual(storySvg, newsSvg);
});

test('layout picker selalu empat tombol sejajar', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'asset-compact.css'), 'utf8');
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
});

test('validator layout menerima section story dan menolak section default saat Cerita dipilih', () => {
  const sourceText = 'Kegagalan dapat mengambil hasil yang diharapkan, tetapi masih ada ruang untuk bertindak. Seseorang dapat membedakan hal yang sudah terjadi dari langkah yang masih bisa dilakukan. Perhatian pada tindakan berikutnya membantu menyusun kembali arah setelah hasil yang mengecewakan.';
  const valid = {
    topic: 'Ruang Bertindak Setelah Kegagalan',
    caption: 'Kegagalan dapat mengambil hasil yang diharapkan, tetapi masih ada ruang untuk bertindak. Membedakan yang sudah terjadi dari langkah berikutnya membantu menyusun kembali arah.',
    hashtags: ['#Kegagalan', '#Pilihan', '#Tindakan'],
    slides: [
      { section: 'PEMBUKA CERITA', title: 'Kegagalan Tidak Menghapus Semua Pilihan yang Tersisa', body: '', points: [] },
      { section: 'SITUASI', title: 'Hasil Buruk Membawa Rasa Kecewa', body: 'Kegagalan dapat mengambil hasil yang sebelumnya sangat diharapkan.', points: ['Rasa kecewa tetap hadir', 'Hasil sudah terjadi'] },
      { section: 'PERKEMBANGAN', title: 'Masih Ada Ruang untuk Bertindak', body: 'Langkah berikutnya masih dapat dipilih setelah hasil mengecewakan.', points: ['Bedakan hasil dan tindakan', 'Perhatian diarahkan kembali'] },
      { section: 'PENYELESAIAN', title: 'Arah Berikutnya Masih Bisa Disusun Kembali', body: 'Membedakan yang sudah terjadi dari tindakan berikutnya membantu menyusun kembali arah setelah hasil mengecewakan.', points: [] }
    ]
  };
  const checked = composer.validateResult(valid, sourceText, 4, 'story');
  assert.equal(checked.errors.some(error => /Tata letak Cerita/i.test(error)), false);

  const wrong = JSON.parse(JSON.stringify(valid));
  wrong.slides[0].section = 'FAKTA UTAMA';
  assert.ok(composer.validateResult(wrong, sourceText, 4, 'story').errors.some(error => /Tata letak Cerita harus dimulai/i.test(error)));
});
