const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const safety = require('../src/services/sourceSafetyPatch');

test('language gate menolak kalimat Inggris mentah tetapi membolehkan istilah teknis Inggris di kalimat Indonesia', () => {
  assert.equal(safety.likelyEnglishDisplay("Mark Zuckerberg published a lengthy essay on Monday"), true);
  assert.equal(safety.likelyEnglishDisplay("Meta CEO presents utopian vision of AI in public debate"), true);
  assert.equal(safety.likelyEnglishDisplay('Meta launches powerful open source model for developers'), true);
  assert.equal(safety.likelyEnglishDisplay('AI model that seeks to rival Anthropic'), true);
  assert.equal(safety.likelyEnglishDisplay('Model open-source ini bisa menjalankan tugas agentic di PC'), false);
  assert.equal(safety.likelyEnglishDisplay('Amankan backup WhatsApp dengan passkey biometrik'), false);
  assert.equal(safety.likelyEnglishDisplay('open-weight AI models'), false);
});

test('manual topic sanitizer mempertahankan bagian Muse Glimmer dan membuang caption/related content yang jauh dari topik', () => {
  const source = [
    "Mark Zuckerberg speaks during the company's Connect developer conference on 17 September 2025 in Menlo Park, California.",
    'Zuckerberg also discussed a broad vision for artificial intelligence and regulation.',
    'Meta introduced Muse Glimmer as a new open-weight model for agentic tasks.',
    'Muse Glimmer can run locally on personal computers with suitable hardware.',
    'The release is part of Meta’s broader open-weight push.',
    'Crew of Zuckerberg yacht did not hear about a separate incident',
    'Another unrelated article discussed a different Silicon Valley dispute.'
  ].join('\n');

  const cleaned = safety.sanitizeSourceTextForManualTopic(source, 'Meta Muse Glimmer terbaru');
  assert.match(cleaned, /Meta introduced Muse Glimmer/i);
  assert.match(cleaned, /Muse Glimmer can run locally/i);
  assert.match(cleaned, /The release is part of Meta/i);
  assert.doesNotMatch(cleaned, /Connect developer conference|broad vision for artificial intelligence|Crew of Zuckerberg yacht|Silicon Valley dispute/i);
});

test('manual topic sanitizer mempertahankan fakta lanjutan jauh setelah penyebutan nama produk', () => {
  const source = [
    'A broad industry introduction appears before the named product.',
    'OpenAI introduced ChatGPT Atlas as a browser product for AI-assisted work.',
    'The model is part of a broader product push.',
    'It can handle tasks across multiple pages after users grant access.',
    'The browser can keep working with the same task context across a longer workflow.',
    'This product remains tied to the same ChatGPT Atlas release.'
  ].join('\n');

  const cleaned = safety.sanitizeSourceTextForManualTopic(source, 'OpenAI ChatGPT Atlas terbaru');
  assert.doesNotMatch(cleaned, /broad industry introduction/i);
  assert.match(cleaned, /OpenAI introduced ChatGPT Atlas/i);
  assert.match(cleaned, /It can handle tasks across multiple pages/i);
  assert.match(cleaned, /The browser can keep working/i);
  assert.match(cleaned, /same ChatGPT Atlas release/i);
});

test('sanitizer tidak mengubah topik umum yang hanya punya satu named anchor', () => {
  const source = 'WhatsApp menyediakan beberapa pengaturan keamanan. Pengguna dapat meninjau perangkat tertaut dan mengaktifkan perlindungan tambahan.';
  assert.equal(safety.sanitizeSourceTextForManualTopic(source, 'Cara Mengamankan WhatsApp Terbaru di 2026'), source);
});

test('install menambahkan language gate ke final source validation', () => {
  safety.install();
  const { validateSourceContent } = require('../src/services/manualSourceFallback');
  const content = {
    hook: 'Meta Muse Glimmer terbaru',
    caption: 'The model was released with open weights for developers',
    cta: 'Baca konteks lengkap',
    slides: [{
      title: 'Meta launches powerful open source model for developers',
      body: 'Meta menjelaskan model baru yang dirilis untuk tugas agenik dan penggunaan lokal.',
      points: [],
      claims: []
    }]
  };
  const errors = validateSourceContent(content, [{ text: 'Meta menjelaskan model baru yang dirilis untuk tugas agenik dan penggunaan lokal.' }]);
  assert.ok(errors.some(error => /bahasa Inggris/i.test(error)));
});
