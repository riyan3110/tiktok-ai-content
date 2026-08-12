const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const composer = require('../src/services/autoSourceComposer');
const content = require('../src/services/content');

function sourceFixture() {
  return [{
    title: 'Gemini mendapatkan kemampuan baru',
    text: [
      'Gemini adalah aplikasi asisten AI dari Google yang menyediakan berbagai kemampuan untuk pengguna.',
      'Google menambahkan kemampuan baru ke Gemini melalui pembaruan produk yang dirilis secara bertahap.',
      'Gemini dapat digunakan untuk membantu memahami informasi dan mengolah berbagai jenis masukan pengguna.',
      'Aplikasi Gemini tersedia pada berbagai perangkat yang didukung oleh layanan Google.',
      'Pengguna dapat berinteraksi dengan Gemini melalui antarmuka aplikasi yang disediakan Google.',
      'Google terus mengembangkan Gemini sebagai bagian dari rangkaian produk kecerdasan buatannya.',
      'Pembaruan Gemini dapat menghadirkan perubahan pada kemampuan yang tersedia untuk pengguna.',
      'Informasi fitur Gemini dijelaskan melalui sumber resmi dan dokumentasi produk Google.'
    ].join(' ')
  }];
}

function denseGenerated() {
  const body = 'Gemini merupakan aplikasi AI Google yang menyediakan berbagai kemampuan untuk membantu pengguna memahami informasi.';
  return {
    focus: { masalah: 'Gemini', penyebab: 'Gemini', solusi: 'Gemini', hasil: 'Gemini' },
    topic: 'Aplikasi Gemini',
    hook: 'Gemini sebagai aplikasi AI Google',
    body,
    caption: body,
    hashtags: [],
    cta: 'Perkembangan Gemini terus berlanjut',
    trendKeywordsUsed: [],
    content_angle: 'fakta Gemini',
    primary_tool: 'tanpa tool',
    hook_pattern: 'source-grounded',
    slides: [0, 1, 2, 3].map(index => ({
      section: index === 0 ? 'PEMBUKA' : index === 3 ? 'KESIMPULAN' : 'FAKTA UTAMA',
      title: index === 0 ? 'Gemini sebagai aplikasi AI Google' : `Perkembangan Gemini bagian ${index + 1}`,
      body,
      points: [
        'Dikembangkan sebagai produk AI Google',
        'Kemampuan tersedia melalui pembaruan bertahap',
        'Informasi fitur mengikuti sumber resmi'
      ],
      claims: []
    }))
  };
}

test('final handoff Auto Source mematikan duplicate gate generik tetapi tetap memakai validator khusus', () => {
  const generated = denseGenerated();
  const genericErrors = content.validateContent(generated, { format: 'Fakta singkat', manualTopic: 'Aplikasi Gemini' });
  assert.ok(genericErrors.some(error => /title, body, dan points mengulang kalimat atau ide yang sama/i.test(error)));

  const calls = [];
  const contentService = {
    validateContent(value, options) {
      calls.push(options);
      return content.validateContent(value, options);
    }
  };
  const errors = composer.validationErrors(contentService, generated, {
    contentFormat: 'Fakta singkat', requestedTopic: 'Aplikasi Gemini', sourceContext: ''
  }, sourceFixture(), { richnessErrors: () => [], filterFalsePositiveMetadataErrors: value => value });

  assert.equal(calls.at(-1)?.validateCopy, false);
  assert.equal(errors.some(error => /title, body, dan points mengulang kalimat atau ide yang sama/i.test(error)), false);
});

test('final handoff mengompakkan point lebih dari tujuh kata dan menjaga claim text sinkron', () => {
  const generated = denseGenerated();
  generated.slides[1].points[2] = 'Informasi fitur Gemini selalu mengikuti penjelasan pada sumber resmi Google';
  generated.slides[1].claims = [{
    field: 'slide:1:point:2',
    text: generated.slides[1].points[2],
    sourceId: 'source-1',
    evidence: 'Informasi fitur Gemini dijelaskan melalui sumber resmi dan dokumentasi produk Google.'
  }];

  const prepared = composer.prepareFinalAutoSourceOutput(generated);
  const point = prepared.slides[1].points[2];
  assert.ok(point.split(/\s+/).length <= 7);
  assert.ok(point.split(/\s+/).length >= 3);
  assert.equal(prepared.slides[1].claims[0].text, point);
});

test('generic layout point gate tetap aktif setelah duplicate gate dimatikan', () => {
  const generated = denseGenerated();
  const contentService = {
    validateContent(value, options) {
      return content.validateContent(value, options);
    }
  };
  generated.slides[0].points[0] = 'satu dua';
  const errors = composer.validationErrors(contentService, generated, {
    contentFormat: 'Fakta singkat', requestedTopic: 'Aplikasi Gemini', sourceContext: ''
  }, sourceFixture(), { richnessErrors: () => [], filterFalsePositiveMetadataErrors: value => value });
  assert.ok(errors.some(error => /point harus 3.?7 kata/i.test(error)));
});

test('Pakai URL tetap keluar sebelum dependency Auto Source dimuat', () => {
  const patch = fs.readFileSync(path.join(__dirname, '../src/services/autoSourcePatch.js'), 'utf8');
  assert.match(patch, /if \(pakaiUrlRequested\(args\)\) return originalGenerateAndSave\(args\);/);
});
