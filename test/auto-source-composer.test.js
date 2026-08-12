const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const { compose, numericGroundingErrors, genericCopyErrors } = require('../src/services/autoSourceComposer');

function groundedContent(text, evidence) {
  return {
    focus: { masalah: text, penyebab: text, solusi: text, hasil: text },
    topic: 'Atlas Search', hook: text, body: text, caption: text, hashtags: [], cta: 'Baca ringkasannya',
    trendKeywordsUsed: [], content_angle: 'fakta Atlas Search', primary_tool: 'Atlas Search', hook_pattern: 'fakta sumber',
    verificationStatus: 'source_based', unsupportedClaims: [],
    slides: [
      { section: 'PEMBUKA', title: 'Atlas Search', body: text, points: [], claims: [{ text, sourceId: 'source-1', evidence }] },
      { section: 'FAKTA', title: 'Fakta utama', body: text, points: [], claims: [{ text, sourceId: 'source-1', evidence }] },
      { section: 'KONTEKS', title: 'Konteks', body: text, points: [], claims: [{ text, sourceId: 'source-1', evidence }] },
      { section: 'PENUTUP', title: 'Ringkasan', body: text, points: [], claims: [{ text, sourceId: 'source-1', evidence }] }
    ]
  };
}

test('translated ordinal is accepted when evidence contains the same ordinal number', () => {
  const evidence = 'Atlas Search was the 14th product to reach one billion users.';
  const content = groundedContent('Atlas Search menjadi produk ke-14 yang mencapai satu miliar pengguna.', evidence);
  assert.deepEqual(numericGroundingErrors(content), []);
});

test('wrong translated ordinal is rejected', () => {
  const evidence = 'Atlas Search was the 14th product to reach one billion users.';
  const content = groundedContent('Atlas Search menjadi produk ke-15 yang mencapai satu miliar pengguna.', evidence);
  assert.ok(numericGroundingErrors(content).some(error => error.includes('15')));
});

test('generic fallback copy is explicitly rejected by auto-source quality gate', () => {
  const generic = groundedContent('Sumber membahas fakta tentang Anthropic watermark.', 'Anthropic plans to add watermarking to generated text.');
  generic.slides[1].title = 'Fakta utama tentang Anthropic watermark';
  generic.slides[3].title = 'Lanjut baca tentang Anthropic watermark';
  assert.ok(genericCopyErrors(generic).length >= 2);
});

test('composer uses source-locked generator and marks result as auto source', async () => {
  const evidence = 'Lentera OS adds local privacy controls for supported devices.';
  const generated = groundedContent('Lentera OS menambah kontrol privasi lokal untuk perangkat yang didukung.', evidence);
  const calls = [];
  const fakeContent = {
    generateContent: async (previousTopics, options) => {
      calls.push({ previousTopics, options });
      return structuredClone(generated);
    },
    validateContent: () => [],
    validateSourceGrounding: () => []
  };
  const sources = [{ url: 'https://example.test/lentera', finalUrl: 'https://example.test/lentera', title: 'Lentera OS update', text: evidence, fetchedAt: '2026-08-12T00:00:00.000Z' }];
  const result = await compose({
    content: fakeContent,
    previousTopics: ['topik lama'],
    options: { requestedTopic: 'Lentera OS', contentFormat: 'Fakta singkat', sourceContext: evidence },
    sources,
    discovery: { searchedAt: '2026-08-12T00:00:00.000Z', queries: ['Lentera OS'], providers: ['test'] }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.useSources, true);
  assert.equal(calls[0].options.topicSource, 'manual');
  assert.equal(result.sourceMode, 'auto');
  assert.equal(result.verificationStatus, 'source_based');
  assert.deepEqual(result.sourceDiscovery.providers, ['test']);
});

test('composer rewrites generic fallback instead of returning placeholder carousel', async () => {
  const evidence = 'Anthropic plans to add watermarking to AI-generated text so content can be identified later.';
  const generic = groundedContent('Sumber membahas fakta tentang Anthropic watermark.', evidence);
  generic.topic = 'Anthropic akan memberi watermark';
  generic.verificationStatus = 'needs_review';
  generic.slides[0].title = 'Anthropic watermark';
  generic.slides[1].title = 'Fakta utama tentang Anthropic watermark';
  generic.slides[2].title = 'Fakta berikutnya tentang Anthropic watermark';
  generic.slides[3].title = 'Lanjut baca tentang Anthropic watermark';
  const repaired = groundedContent('Anthropic menyiapkan watermark untuk membantu mengidentifikasi teks yang dibuat AI.', evidence);
  repaired.topic = generic.topic;
  repaired.slides[0].title = 'Watermark untuk teks AI';
  repaired.slides[1].title = 'Penanda dibuat tak terlihat';
  repaired.slides[2].title = 'Tujuannya memudahkan identifikasi';
  repaired.slides[3].title = 'Jejak tetap bisa diperiksa';
  const finalizerCalls = [];
  const fakeFinalizer = {
    rewriteAllSourcesWithAi: async input => {
      finalizerCalls.push(input);
      return structuredClone(repaired);
    }
  };
  const fakeContent = {
    generateContent: async () => structuredClone(generic),
    validateContent: () => [],
    validateSourceGrounding: () => []
  };
  const sources = [{ url: 'https://example.test/anthropic-watermark', finalUrl: 'https://example.test/anthropic-watermark', title: 'Anthropic watermark', text: evidence, fetchedAt: '2026-08-12T00:00:00.000Z' }];
  const result = await compose({
    content: fakeContent,
    finalizer: fakeFinalizer,
    options: { requestedTopic: generic.topic, contentFormat: 'Fakta singkat', sourceContext: evidence },
    sources
  });

  assert.equal(finalizerCalls.length, 1);
  assert.equal(genericCopyErrors(result).length, 0);
  assert.equal(result.verificationStatus, 'source_based');
  assert.equal(result.sourceMode, 'auto');
});

test('composer can recover when the first source generation throws validation error', async () => {
  const evidence = 'Northstar adds a provenance marker to generated documents.';
  const repaired = groundedContent('Northstar menambahkan penanda asal pada dokumen yang dihasilkan.', evidence);
  const finalizerCalls = [];
  const fakeContent = {
    generateContent: async () => { throw new Error('Slide 2 mengulang ide yang sama.'); },
    validateContent: () => [],
    validateSourceGrounding: () => []
  };
  const fakeFinalizer = {
    rewriteAllSourcesWithAi: async input => {
      finalizerCalls.push(input);
      return structuredClone(repaired);
    }
  };
  const sources = [{ url: 'https://example.test/northstar', finalUrl: 'https://example.test/northstar', title: 'Northstar provenance', text: evidence, fetchedAt: '2026-08-12T00:00:00.000Z' }];
  const result = await compose({
    content: fakeContent,
    finalizer: fakeFinalizer,
    options: { requestedTopic: 'Northstar provenance', contentFormat: 'Fakta singkat', sourceContext: evidence },
    sources
  });
  assert.equal(finalizerCalls.length, 1);
  assert.equal(result.sourceMode, 'auto');
});
