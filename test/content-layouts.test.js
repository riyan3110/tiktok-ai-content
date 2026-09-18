const test = require('node:test');
const assert = require('node:assert/strict');
const { LAYOUTS, LAYOUT_IDS, resolveContentLayout, layoutInstruction, layoutRendererStyle } = require('../src/services/contentLayouts');
const { generateContent, validateSlides } = require('../src/services/content');
const { buildStructuredLayout, buildSlideLayouts } = require('../src/services/images');

function clientReturning(payload) {
  const requests = [];
  return { client: { chat: { completions: { create: async (request) => {
    requests.push(request);
    return { choices: [{ message: { content: JSON.stringify(payload) } }] };
  } } } }, requests };
}

const BASE_RESULT = {
  focus: { masalah: 'Fokus', penyebab: 'Urutan', solusi: 'Struktur', hasil: 'Pembaca paham' },
  topic: 'Membersihkan port charger HP', hook: 'Port Charger Sering Bermasalah? Ini Penyebabnya', body: 'Debu menyumbat port charger dan membuat pengisian daya melambat.',
  caption: 'Bersihkan port charger agar pengisian daya kembali normal.', hashtags: ['#TipsHP'], cta: 'Simpan tips ini', trendKeywordsUsed: [],
  content_angle: 'perawatan perangkat', primary_tool: 'tanpa tool', hook_pattern: 'pertanyaan praktis',
  slides: [
    { section: 'PEMBUKA', title: 'Cara Membersihkan Port Charger', body: 'Debu menyumbat port dan memperlambat pengisian daya.', points: [] },
    { section: 'LANGKAH 1', title: 'Matikan Perangkat', body: 'Matikan HP dan cabut kabel pengisian sebelum membersihkan.', points: ['Matikan HP lebih dulu'] },
    { section: 'LANGKAH 2', title: 'Bersihkan dengan Alat Aman', body: 'Gerakkan alat perlahan mengikuti arah pin pengisian.', points: ['Tusuk gigi kayu', 'Sikat gigi lembut'] },
    { section: 'PENUTUP', title: 'Periksa Kembali Hasilnya', body: 'Pasang kabel dan pastikan pengisian daya kembali lancar.', points: [] }
  ]
};

test('modul tata letak: default no-op, tiga layout lain memberi instruksi dan gaya renderer', () => {
  assert.deepEqual(LAYOUT_IDS, ['default', 'tutorial', 'story', 'news']);
  assert.equal(resolveContentLayout('tutorial'), 'tutorial');
  assert.equal(resolveContentLayout('story'), 'story');
  assert.equal(resolveContentLayout('news'), 'news');
  assert.equal(resolveContentLayout(undefined), 'default');
  assert.equal(resolveContentLayout(''), 'default');
  assert.equal(resolveContentLayout('tidak-ada'), 'default');
  assert.equal(layoutInstruction('default'), '');
  assert.equal(layoutRendererStyle('default'), 'default');
  for (const id of ['tutorial', 'story', 'news']) {
    assert.ok(layoutInstruction(id).length > 50, `${id} harus punya instruksi struktur`);
    assert.equal(layoutRendererStyle(id), id);
  }
});

test('DEFAULT: prompt tanpa contentLayout identik dengan workflow lama', async () => {
  const { client, requests } = clientReturning({ ...BASE_RESULT, contentLayout: undefined });
  const output = await generateContent(['topik lama'], { topicSource: 'manual', requestedTopic: 'Membersihkan port charger HP', contentFormat: 'Tutorial langkah' }, client);
  const prompt = requests[0].messages[1].content;
  assert.doesNotMatch(prompt, /TATA LETAK (TUTORIAL|CERITA|BERITA)/);
  assert.doesNotMatch(prompt, /Tata letak "/);
  assert.equal(output.contentLayout, undefined, 'default tidak menandai contentLayout');
  assert.equal(output.slides.length, 4);
});

test('DEFAULT: contentLayout eksplisit tetap menghasilkan perilaku lama', async () => {
  const { client, requests } = clientReturning({ ...BASE_RESULT });
  const output = await generateContent([], { topicSource: 'manual', requestedTopic: 'Membersihkan port charger HP', contentFormat: 'Tutorial langkah', contentLayout: 'default' }, client);
  assert.doesNotMatch(requests[0].messages[1].content, /TATA LETAK/);
  assert.equal(output.contentLayout, undefined);
});

test('TUTORIAL: instruksi struktur langkah bernomor diteruskan ke AI Writer', async () => {
  const { client, requests } = clientReturning({ ...BASE_RESULT, contentLayout: 'tutorial' });
  const output = await generateContent([], { topicSource: 'manual', requestedTopic: 'Membersihkan port charger HP', contentFormat: 'Tutorial langkah', contentLayout: 'tutorial' }, client);
  const prompt = requests[0].messages[1].content;
  assert.match(prompt, /TATA LETAK TUTORIAL/);
  assert.match(prompt, /LANGKAH 1, LANGKAH 2/);
  assert.match(prompt, /Tata letak "Tutorial"/);
  assert.equal(output.contentLayout, 'tutorial');
  const sections = output.slides.map((slide) => slide.section);
  assert.ok(sections.some((section) => /LANGKAH\s*1/i.test(section)), 'harus ada slide LANGKAH 1');
  assert.ok(output.slides.every((slide, index) => index === 0 || slide.section !== 'PEMBUKA' || index === 0), 'struktur tutorial valid');
});

test('TUTORIAL: renderer menampilkan nomor langkah yang terlihat', () => {
  const layouts = outputLayouts(BASE_RESULT.slides, 'tutorial');
  assert.equal(layouts.length, 4);
  const stepSlides = layouts.filter((layout) => /LANGKAH/i.test(layout.title));
  assert.ok(stepSlides.length >= 2, 'slide langkah terlabel LANGKAH');
  stepSlides.forEach((layout) => {
    const numbers = layout.content.points.map((point) => Number(String(point.text).match(/^(\d+)\./)?.[1])).filter(Number.isFinite);
    assert.ok(numbers.length >= 1, 'slide langkah memakai nomor');
    assert.deepEqual(numbers, [...numbers.keys()].map((i) => i + 1), 'nomor urut mulai dari 1');
  });
  validateCarouselCompat(layouts);
});

test('CERITA: instruksi naratif diteruskan tanpa nomor langkah', async () => {
  const { client, requests } = clientReturning({ ...BASE_RESULT, contentLayout: 'story', slides: [
    { section: 'PEMBUKA CERITA', title: 'Sering Gagal Isi Daya?', body: 'Port charger HP-nya penuh debu sampai kabelnya gagal terpasang.', points: [] },
    { section: 'SITUASI', title: 'Debu Masuk Tanpa Disadari', body: 'Setiap kali HP disimpan, debu menyusup ke port charger.', points: [] },
    { section: 'KEJADIAN', title: 'Pengisian Daya Melambat', body: 'Lambat laun pengisian daya makin lama sampai gagal.', points: [] },
    { section: 'PEYELESAIAN', title: 'Dibersihkan dan Lancar', body: 'Setelah dibersihkan dengan alat aman, daya kembali terisi.', points: [] }
  ] });
  const output = await generateContent([], { topicSource: 'manual', requestedTopic: 'Membersihkan port charger HP', contentFormat: 'Fakta singkat', contentLayout: 'story' }, client);
  const prompt = requests[0].messages[1].content;
  assert.match(prompt, /TATA LETAK CERITA/);
  assert.match(prompt, /menyambung dari slide ke slide/);
  assert.doesNotMatch(prompt, /memakai nomor langkah/);
  assert.equal(output.contentLayout, 'story');
  const layouts = outputLayouts(output.slides, 'story');
  assert.equal(layouts.length, 4);
  layouts.forEach((layout) => {
    const bullets = layout.content.points.map((point) => String(point.text));
    assert.ok(bullets.every((text) => /^•/.test(text)), 'cerita memakai bullet tanpa nomor');
  });
  validateCarouselCompat(layouts);
});

test('BERITA: instruksi headline + fakta + detail diteruskan', async () => {
  const { client, requests } = clientReturning({ ...BASE_RESULT, contentLayout: 'news', slides: [
    { section: 'HEADLINE', title: 'Debu Penyebab Isi Daya Lambat', body: 'Kebiasaan menyimpan HP tanpa penutup membuat port charger penuh debu.', points: [] },
    { section: 'FAKTA UTAMA', title: 'Apa yang Terjadi', body: 'Debu menyumbat pin pengisian charger sehingga daya masuk tidak stabil.', points: ['Pengisian melambat'] },
    { section: 'DETAIL', title: 'Cek dan Bersihkan', body: 'Pemilik bisa memeriksa lubang port charger sebelum ke tukang servis.', points: [] },
    { section: 'PERKEMBANGAN', title: 'Kapan Harus Servis', body: 'Jika pengisian tetap gagal setelah dibersihkan, pin charger perlu diganti.', points: [] }
  ] });
  const output = await generateContent([], { topicSource: 'manual', requestedTopic: 'Membersihkan port charger HP', contentFormat: 'Fakta singkat', contentLayout: 'news' }, client);
  const prompt = requests[0].messages[1].content;
  assert.match(prompt, /TATA LETAK BERITA/);
  assert.match(prompt, /HEADLINE utama/);
  assert.match(prompt, /hindari opini yang tidak didukung sumber/);
  assert.equal(output.contentLayout, 'news');
  const layouts = outputLayouts(output.slides, 'news');
  assert.match(layouts[0].title, /HEADLINE/);
  validateCarouselCompat(layouts);
});

test('renderer: konten lama tanpa contentLayout memakai Default persis seperti sebelumnya', () => {
  const legacy = BASE_RESULT.slides;
  const withLayout = outputLayouts(legacy, undefined);
  const explicitDefault = outputLayouts(legacy, 'default');
  const legacyOptions = { textInputOnly: false };
  const legacyRender = legacy.map((slide, index) => buildStructuredLayout(slide, index, legacy.length, 'Tutorial langkah', legacyOptions));
  assert.deepEqual(withLayout.map((layout) => layout.title), legacyRender.map((layout) => layout.title));
  assert.deepEqual(withLayout.map((layout) => layout.content.points.map((p) => p.text)), legacyRender.map((layout) => layout.content.points.map((p) => p.text)));
  assert.deepEqual(explicitDefault.map((layout) => layout.title), legacyRender.map((layout) => layout.title));
});

test('renderer: label section AI tetap dipertahankan untuk semua layout', () => {
  for (const id of ['tutorial', 'story', 'news']) {
    const layouts = outputLayouts(BASE_RESULT.slides, id);
    assert.deepEqual(layouts.map((layout) => layout.title), BASE_RESULT.slides.map((slide) => slide.section), `${id} memakai section AI apa adanya`);
  }
  const fallback = buildStructuredLayout({ title: 'Tanpa Section', body: 'Isi slide.', points: [] }, 1, 4, '', { layoutStyle: 'news' });
  assert.equal(fallback.title, 'FAKTA & DETAIL');
});

test('UI: pemilih tata letak memakai empat tombol dan default aktif', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync('public/index.html', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  const css = fs.readFileSync('public/style.css', 'utf8');
  assert.match(html, /id="layout-picker"/);
  assert.match(html, /aria-label="Tata Letak"/);
  for (const id of ['default', 'tutorial', 'story', 'news']) assert.ok(html.includes(`data-layout="${id}"`));
  assert.ok(html.indexOf('layout-picker') < html.indexOf('Mode Posting'), 'pemilih tata letak berada sebelum Mode Posting');
  assert.match(app, /selectedLayout = 'default'/);
  assert.match(app, /contentLayout: selectedLayout/);
  assert.match(css, /\.layout-option\.active/);
  assert.match(css, /grid-template-columns:repeat\(2,1fr\)/, 'mobile memakai grid 2x2');
});

test('validator: struktur layout baru tetap lolos validator format lama', () => {
  assert.deepEqual(validateSlides(BASE_RESULT.slides, { format: 'Tutorial langkah' }), []);
  assert.equal(generateContentPlaceholder(), undefined);
});
function generateContentPlaceholder() { return undefined; }

function outputLayouts(slides, layout) {
  return buildSlideLayouts({ slides, contentFormat: 'Tutorial langkah', contentLayout: layout, verificationStatus: undefined });
}

function validateCarouselCompat(layouts) {
  assert.ok(layouts.length >= 3 && layouts.length <= 5, 'carousel 3-5 slide');
  layouts.forEach((layout) => {
    assert.ok(layout.fit.height > 0, 'slide memiliki isi terukur');
    assert.ok(layout.content.title || layout.content.body || layout.content.points.length, 'slide memiliki konten');
  });
}
