const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const softFit = require('../src/services/textInputSoftFitPatch');
const verbatim = require('../src/services/textInputVerbatimPatch');
const autoSourcePatch = require('../src/services/autoSourcePatch');

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


test('Tutorial Cerita dan Berita memakai renderer visual yang berbeda', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    require('./src/services/slideSpacingPatch').install();
    const images = require('./src/services/images');
    const slide = { section: 'SITUASI', title: 'Judul cerita yang cukup jelas', body: 'Isi singkat untuk menguji komposisi visual.', points: ['Poin pertama yang jelas', 'Poin kedua yang jelas'] };
    const background = { color: '#f5efe4', textColor: '#000000' };
    for (const style of ['tutorial','story','news']) {
      const layout = images.buildStructuredLayout(slide, 1, 4, 'Fakta singkat', { textInputOnly: true, layoutStyle: style });
      process.stdout.write(images.renderLayout(layout, 2, 4, { enabled: false }, background) + '\\n---' + style + '---\\n');
    }
  `;
  const output = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.match(output, /data-layout="tutorial"/);
  assert.match(output, /TUTORIAL ·/);
  assert.match(output, /data-layout="story"/);
  assert.match(output, /CERITA ·/);
  assert.match(output, />“</);
  assert.match(output, /data-layout="news"/);
  assert.match(output, />BERITA</);
  assert.match(output, />01</);
});

test('empat tombol tata letak memenuhi lebar panel dan tetap nyaman disentuh', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'asset-compact.css'), 'utf8');
  assert.match(css, /#legacy-studio #content-generator > #layout-picker[\s\S]*grid-column:1\/-1!important/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
  assert.match(css, /min-height:82px!important/);
  assert.match(css, /width:27px!important/);
});
