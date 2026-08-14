const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const composer = require('../src/services/textInputComposer');
const images = require('../src/services/images');
const patch = require('../src/services/textInputVerbatimPatch');

const pasted = `SLIDE 1 — HOOK

Ultrafast Membuat GPT-5.6 Sol Hingga 14 Kali Lebih Cepat

SLIDE 2 — FAKTA UTAMA

Cerebras Dorong Kecepatan Inferensi GPT-5.6 Sol

Ultrafast ditenagai Cerebras dan mencapai hingga 750 output token per detik.

• Service tier API baru
• Fokus pada kecepatan inferensi
• Bukan model GPT berbeda

SLIDE 3 — DETAIL

Memangkas Waktu Tunggu untuk Tugas Kompleks

Peningkatan kecepatan ditujukan agar pekerjaan berat dapat diselesaikan lebih responsif.

• Coding dan riset
• Penggunaan agen AI
• Tugas kompleks lainnya

SLIDE 4 — PENUTUP

Ultrafast Berbeda dari Ultra Mode

Ultrafast berfokus pada percepatan inferensi, sedangkan Ultra mode menggunakan beberapa subagen untuk mengerjakan tugas kompleks secara paralel.

CAPTION

OpenAI memperkenalkan Ultrafast, service tier API baru untuk GPT-5.6 Sol yang ditenagai Cerebras. Ultrafast dapat bekerja hingga 14 kali lebih cepat dan menghasilkan hingga 750 output token per detik.`;

test('Generate dari Teks uses pasted copy verbatim and never calls an AI client', async t => {
  patch.install();
  t.after(() => patch.resetForTests());
  let aiCalls = 0;
  const client = { chat: { completions: { create: async () => { aiCalls += 1; throw new Error('AI must not be called'); } } } };

  const result = await composer.compose({ text: pasted, client });

  assert.equal(aiCalls, 0);
  assert.deepEqual(result.slides, [
    { section: 'HOOK', title: 'Ultrafast Membuat GPT-5.6 Sol Hingga 14 Kali Lebih Cepat', body: '', points: [] },
    { section: 'FAKTA UTAMA', title: 'Cerebras Dorong Kecepatan Inferensi GPT-5.6 Sol', body: 'Ultrafast ditenagai Cerebras dan mencapai hingga 750 output token per detik.', points: ['Service tier API baru', 'Fokus pada kecepatan inferensi', 'Bukan model GPT berbeda'] },
    { section: 'DETAIL', title: 'Memangkas Waktu Tunggu untuk Tugas Kompleks', body: 'Peningkatan kecepatan ditujukan agar pekerjaan berat dapat diselesaikan lebih responsif.', points: ['Coding dan riset', 'Penggunaan agen AI', 'Tugas kompleks lainnya'] },
    { section: 'PENUTUP', title: 'Ultrafast Berbeda dari Ultra Mode', body: 'Ultrafast berfokus pada percepatan inferensi, sedangkan Ultra mode menggunakan beberapa subagen untuk mengerjakan tugas kompleks secara paralel.', points: [] }
  ]);
  assert.equal(result.caption, 'OpenAI memperkenalkan Ultrafast, service tier API baru untuk GPT-5.6 Sol yang ditenagai Cerebras. Ultrafast dapat bekerja hingga 14 kali lebih cepat dan menghasilkan hingga 750 output token per detik.');
  assert.deepEqual(result.hashtags, []);
});

test('unstructured input is rejected instead of being rewritten by AI', async () => {
  await assert.rejects(
    () => patch.composeVerbatim({ text: 'Ini hanya berita biasa tanpa struktur carousel dan tidak boleh ditulis ulang oleh sistem.' }),
    error => error.status === 422 && /HOOK|SLIDE 1/i.test(error.message)
  );
});

test('text-input renderer hides routing labels and keeps pasted copy only', async () => {
  const content = await patch.composeVerbatim({ text: pasted });
  content.contentFormat = 'Tutorial langkah';
  const prepared = patch.prepareVerbatimRenderContent(content);
  const layouts = images.buildSlideLayouts(prepared);

  assert.equal(layouts.length, 4);
  assert.equal(layouts[0].textInputHook, true);
  const hookSvg = images.renderLayout(layouts[0], 1, 4, { enabled: false }, {});
  const factSvg = images.renderLayout(layouts[1], 2, 4, { enabled: false }, {});

  assert.match(hookSvg, /Ultrafast Membuat GPT-5\.6 Sol Hingga 14 Kali Lebih Cepat/);
  assert.match(hookSvg, /y="740"/);
  assert.doesNotMatch(hookSvg, />HOOK</i);
  assert.doesNotMatch(factSvg, /FAKTA UTAMA/i);
  assert.match(factSvg, /Cerebras Dorong Kecepatan Inferensi GPT-5\.6 Sol/);
  assert.match(factSvg, /Service tier API baru/);
});

test('Pakai URL renderer behavior remains unchanged', () => {
  const slides = [
    { section: 'HOOK', title: 'Judul sumber yang tetap memakai label renderer', body: '', points: [] },
    { section: 'FAKTA UTAMA', title: 'Fakta dari sumber', body: 'Body sumber tetap menggunakan renderer yang sudah ada.', points: ['Poin sumber pertama', 'Poin sumber kedua'] },
    { section: 'DETAIL', title: 'Detail dari sumber', body: 'Detail sumber tetap berada pada jalur Pakai URL.', points: ['Konteks sumber pertama', 'Konteks sumber kedua'] },
    { section: 'PENUTUP', title: 'Kesimpulan dari sumber', body: 'Penutup sumber tetap menggunakan perilaku renderer sebelumnya tanpa perubahan dari mode teks.', points: [] }
  ];
  const layouts = images.buildSlideLayouts({ slides, contentFormat: 'Fakta singkat', verificationStatus: 'source_based' });
  const svg = images.renderLayout(layouts[0], 1, 4, { enabled: false }, {});
  assert.match(svg, />HOOK</i);
  assert.equal(layouts[0].textInputHook, false);
});

test('verbatim renderer rejects overflow instead of adding continuation copy', () => {
  const longTitle = Array.from({ length: 45 }, (_, index) => `Kata${index + 1}`).join(' ');
  const content = {
    verificationStatus: 'text_input_only',
    contentFormat: 'Tutorial langkah',
    slides: [
      { section: 'HOOK', title: longTitle, body: '', points: [] },
      { section: 'FAKTA UTAMA', title: 'Judul dua', body: 'Body yang cukup singkat untuk tetap muat pada template.', points: ['Poin pertama singkat', 'Poin kedua singkat'] },
      { section: 'DETAIL', title: 'Judul tiga', body: 'Body yang cukup singkat untuk tetap muat pada template.', points: ['Poin ketiga singkat', 'Poin keempat singkat'] },
      { section: 'PENUTUP', title: 'Judul empat', body: 'Penutup yang cukup singkat untuk tetap muat pada template tanpa perubahan otomatis apa pun.', points: [] }
    ]
  };

  assert.throws(
    () => patch.prepareVerbatimRenderContent(content),
    error => error.status === 422 && /tidak akan memotong, menulis ulang, atau menambah kalimat/i.test(error.message)
  );
});

test('Generate dari Teks UI states the copy-lock contract', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../public/background-state.js'), 'utf8');
  assert.match(ui, /Label bagian hanya dipakai untuk penempatan dan tidak ikut tampil/i);
  assert.match(ui, /tidak menulis ulang, meringkas, memotong, atau menambah kalimat/i);
});
