const test = require('node:test');
const assert = require('node:assert/strict');
const images = require('../src/services/images');
const patch = require('../src/services/textInputSoftFitPatch');

const closingBody = 'Ultrafast berfokus pada percepatan inferensi, sedangkan Ultra mode menggunakan beberapa subagen untuk mengerjakan tugas kompleks secara paralel.';

function sampleContent() {
  return {
    verificationStatus: 'text_input_only',
    contentFormat: 'Fakta singkat',
    slides: [
      { section: 'HOOK', title: 'Ultrafast Membuat GPT-5.6 Sol Hingga 14 Kali Lebih Cepat', body: '', points: [] },
      { section: 'FAKTA UTAMA', title: 'Cerebras Dorong Kecepatan Inferensi GPT-5.6 Sol', body: 'Ultrafast ditenagai Cerebras dan mencapai hingga 750 output token per detik.', points: ['Service tier API baru', 'Fokus pada kecepatan inferensi', 'Bukan model GPT berbeda'] },
      { section: 'DETAIL', title: 'Memangkas Waktu Tunggu untuk Tugas Kompleks', body: 'Peningkatan kecepatan ditujukan agar pekerjaan berat dapat diselesaikan lebih responsif.', points: ['Coding dan riset', 'Penggunaan agen AI', 'Tugas kompleks lainnya'] },
      { section: 'PENUTUP', title: 'Ultrafast Berbeda dari Ultra Mode', body: closingBody, points: [] }
    ]
  };
}

function words(value) {
  return String(value || '').toLocaleLowerCase('id-ID').match(/[a-z0-9.-]+/g) || [];
}

test('slight body overflow is shortened only by deleting trailing pasted words', () => {
  const prepared = patch.prepareSoftFitContent(sampleContent());
  const shortened = prepared.slides[3].body;

  assert.ok(prepared.textInputSoftTrimmedSlides.includes(4));
  assert.ok(shortened.length < closingBody.length);
  const originalWords = words(closingBody);
  const shortenedWords = words(shortened);
  assert.deepEqual(shortenedWords, originalWords.slice(0, shortenedWords.length));
  assert.ok(shortenedWords.length >= Math.ceil(originalWords.length * patch.BODY_MIN_KEEP_RATIO));

  const layout = images.buildStructuredLayout(prepared.slides[3], 3, 4, prepared.contentFormat, { textInputOnly: true });
  assert.doesNotThrow(() => images.validateVisualLayout(layout, { slideIndex: 4 }));
});

test('preferred trimming keeps sentence flow by dropping optional trailing phrases first', () => {
  const candidates = patch.bodyCandidates(closingBody);
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0], 'Ultrafast berfokus pada percepatan inferensi, sedangkan Ultra mode menggunakan beberapa subagen untuk mengerjakan tugas kompleks.');
});

test('slides 2 to 4 can be lowered without moving labels or slide 1', () => {
  const svg = '<svg><text y="270">watermark</text><text y="425">label</text><text y="610">title</text><text y="760">body</text></svg>';
  const shifted = patch.shiftContentText(svg, patch.TEXT_INPUT_LOWER_SHIFT);

  assert.match(shifted, /y="270">watermark/);
  assert.match(shifted, /y="425">label/);
  assert.match(shifted, /y="680">title/);
  assert.match(shifted, /y="830">body/);
});

test('lowering amount is capped by remaining bottom-safe-area slack', () => {
  const prepared = patch.prepareSoftFitContent(sampleContent());
  const layout = images.buildStructuredLayout(prepared.slides[1], 1, 4, prepared.contentFormat, { textInputOnly: true });
  const shift = patch.lowerShiftForLayout(layout);
  assert.ok(shift >= 0);
  assert.ok(shift <= patch.TEXT_INPUT_LOWER_SHIFT);
});
