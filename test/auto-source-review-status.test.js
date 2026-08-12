const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const { compose } = require('../src/services/autoSourceComposer');

test('auto-source needs_review draft must be repaired before it can become source_based', async () => {
  const evidence = 'Harbor Battery may expand the trial to two additional routes after the current evaluation is completed.';
  const generated = {
    focus: { masalah: 'Uji coba baterai', penyebab: 'Perlu data lapangan', solusi: 'Perluasan masih mungkin', hasil: 'Belum pasti' },
    topic: 'Harbor Battery', hook: 'Uji coba Harbor Battery', body: 'Perluasan uji coba masih bersifat kemungkinan.', caption: 'Perluasan uji coba masih bersifat kemungkinan.', hashtags: [], cta: 'Lihat konteks sumber',
    trendKeywordsUsed: [], content_angle: 'uji coba lapangan', primary_tool: 'Harbor Battery', hook_pattern: 'fakta sumber',
    verificationStatus: 'needs_review', unsupportedClaims: ['Sumber belum cukup untuk memastikan perluasan.'],
    slides: Array.from({ length: 4 }, (_, index) => ({ section: index ? 'KONTEKS' : 'PEMBUKA', title: `Harbor Battery ${index + 1}`, body: 'Perluasan uji coba masih bersifat kemungkinan.', points: [], claims: [{ text: 'Perluasan uji coba masih bersifat kemungkinan.', sourceId: 'source-1', evidence }] }))
  };
  const repaired = structuredClone(generated);
  repaired.verificationStatus = 'source_based';
  repaired.unsupportedClaims = [];
  repaired.slides = repaired.slides.map((slide, index) => ({
    ...slide,
    title: `Harbor Battery fakta ${index + 1}`,
    body: 'Harbor Battery masih mengevaluasi uji coba sebelum mempertimbangkan perluasan ke rute tambahan.',
    points: ['Perluasan masih bersifat kemungkinan', 'Evaluasi berjalan lebih dulu'],
    claims: []
  }));
  const finalizerCalls = [];
  const fakeContent = {
    generateContent: async () => structuredClone(generated),
    validateContent: () => [],
    validateSourceGrounding: () => []
  };
  const fakeFinalizer = {
    richnessErrors: () => [],
    rewriteAllSourcesWithAi: async input => {
      finalizerCalls.push(input);
      return structuredClone(repaired);
    }
  };
  const result = await compose({
    content: fakeContent,
    finalizer: fakeFinalizer,
    options: { requestedTopic: 'Harbor Battery', contentFormat: 'Fakta singkat', sourceContext: evidence },
    sources: [{ url: 'https://example.test/harbor', title: 'Harbor Battery trial', text: evidence }]
  });
  assert.equal(finalizerCalls.length, 1);
  assert.equal(result.verificationStatus, 'source_based');
  assert.deepEqual(result.unsupportedClaims, []);
});
