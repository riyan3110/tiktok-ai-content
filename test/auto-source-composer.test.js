const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const { compose, numericGroundingErrors } = require('../src/services/autoSourceComposer');

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
