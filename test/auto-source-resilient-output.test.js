const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/autoSourceResilientFinalizer');

function facts(count = 20) {
  return Array.from({ length: count }, (_, index) => ({
    sourceId: `source-${(index % 2) + 1}`,
    evidence: `Fakta ${index + 1} menjelaskan detail berbeda yang relevan dengan topik pengujian.`
  }));
}

function slide(body, points = ['Fakta berbeda pertama', 'Fakta berbeda kedua', 'Fakta berbeda ketiga']) {
  return { section: 'FAKTA UTAMA', title: 'Judul fakta yang natural', body, points, claims: [] };
}

test('body 9 atau 21 kata tidak lagi menggagalkan carousel bila masih dalam hard layout 8-24', () => {
  const nineWords = 'Produk baru membawa fitur utama untuk pengguna secara bertahap.';
  const twentyOneWords = 'Produk baru ini membawa sejumlah kemampuan utama untuk pengguna dan diperkenalkan secara bertahap melalui pembaruan yang dijelaskan oleh sumber resmi tersebut.';
  assert.equal(nineWords.split(/\s+/).length, 9);
  assert.equal(twentyOneWords.split(/\s+/).length, 21);
  assert.deepEqual(finalizer.relaxedDensityErrors({ slides: [slide(nineWords)] }, facts()), []);
  assert.deepEqual(finalizer.relaxedDensityErrors({ slides: [slide(twentyOneWords)] }, facts()), []);
});

test('body di luar 8-24 tetap ditolak agar layout tidak berantakan', () => {
  const tooShort = 'Fakta ini terlalu pendek.';
  const errors = finalizer.relaxedDensityErrors({ slides: [slide(tooShort)] }, facts());
  assert.ok(errors.some(error => /body harus 8-24 kata/i.test(error)));
});

test('source kaya tetap mewajibkan tiga bullet fakta per slide', () => {
  const content = { slides: [slide('Produk ini memiliki konteks faktual yang cukup jelas untuk pembaca.', ['Fakta pertama saja', 'Fakta kedua saja'])] };
  const errors = finalizer.relaxedDensityErrors(content, facts());
  assert.ok(errors.some(error => /wajib tepat 3 bullet fakta berbeda/i.test(error)));
});

test('model/version dianggap grounded bila entity plus versi ada pada source context yang sama', () => {
  const claim = { text: 'ChatGPT 5.6 membawa pembaruan baru', sourceId: 'source-1' };
  const source = { title: 'OpenAI memperkenalkan ChatGPT-5.6', text: 'ChatGPT 5.6 is described in the release notes.' };
  assert.equal(finalizer.modelVersionSupportedBySource(claim, source), true);
});

test('angka biasa tidak diloloskan hanya karena ada angka lain di source', () => {
  const claim = { text: 'ChatGPT 5.6 membawa pembaruan baru', sourceId: 'source-1' };
  const source = { title: 'OpenAI memperkenalkan ChatGPT 5.5', text: 'Release notes discuss version 5.5 only.' };
  assert.equal(finalizer.modelVersionSupportedBySource(claim, source), false);
});

test('prompt mewajibkan evidence untuk title faktual', () => {
  const generated = { slides: [slide('Produk ini memiliki konteks faktual yang cukup jelas untuk pembaca.')], topic: 'Produk AI' };
  const sources = [
    { title: 'Sumber satu', text: 'Produk AI memiliki beberapa kemampuan baru dan tersedia bertahap.' },
    { title: 'Sumber dua', text: 'Sumber kedua memberikan konteks tambahan yang berbeda dan relevan.' }
  ];
  const prompt = finalizer.prompt({ generated, sources, facts: facts(), format: 'Fakta singkat', topic: 'Produk AI', errors: [] });
  assert.match(prompt, /TITLE EVIDENCE CONTRACT/i);
  assert.match(prompt, /claim title dengan field slide:X:title/i);
  assert.match(prompt, /Target body tetap 10-20 kata/i);
  assert.match(prompt, /Hard layout hanya 8-24 kata/i);
});

test('production tetap mengunci Pakai URL sebelum memuat Auto Source dan memakai resilient finalizer', () => {
  const patchSource = fs.readFileSync(path.join(__dirname, '../src/services/autoSourcePatch.js'), 'utf8');
  assert.match(patchSource, /if \(pakaiUrlRequested\(args\)\) return originalGenerateAndSave\(args\);/);
  assert.match(patchSource, /autoSourceResilientFinalizer/);
  assert.match(patchSource, /finalizer:\s*autoSourceResilientFinalizer/);
  assert.doesNotMatch(patchSource, /finalizer:\s*autoSourceStrictFinalizer/);
  assert.doesNotMatch(patchSource, /\[activeSources\.length,\s*1\]/);
});