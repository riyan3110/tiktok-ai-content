const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const { compose } = require('../src/services/autoSourceComposer');

test('auto-source composer preserves needs_review instead of upgrading uncertain content to source_based', async () => {
  const evidence = 'Harbor Battery may expand the trial to two additional routes.';
  const generated = {
    focus: { masalah: 'Uji coba baterai', penyebab: 'Perlu data lapangan', solusi: 'Perluasan masih mungkin', hasil: 'Belum pasti' },
    topic: 'Harbor Battery', hook: 'Uji coba Harbor Battery', body: 'Perluasan uji coba masih bersifat kemungkinan.', caption: 'Perluasan uji coba masih bersifat kemungkinan.', hashtags: [], cta: 'Lihat konteks sumber',
    trendKeywordsUsed: [], content_angle: 'uji coba lapangan', primary_tool: 'Harbor Battery', hook_pattern: 'fakta sumber',
    verificationStatus: 'needs_review', unsupportedClaims: ['Sumber belum cukup untuk memastikan perluasan.'],
    slides: Array.from({ length: 4 }, (_, index) => ({ section: index ? 'KONTEKS' : 'PEMBUKA', title: `Harbor Battery ${index + 1}`, body: 'Perluasan uji coba masih bersifat kemungkinan.', points: [], claims: [{ text: 'Perluasan uji coba masih bersifat kemungkinan.', sourceId: 'source-1', evidence }] }))
  };
  const fakeContent = {
    generateContent: async () => structuredClone(generated),
    validateContent: () => [],
    validateSourceGrounding: () => []
  };
  const result = await compose({ content: fakeContent, options: { requestedTopic: 'Harbor Battery', contentFormat: 'Fakta singkat', sourceContext: evidence }, sources: [{ url: 'https://example.test/harbor', title: 'Harbor Battery trial', text: evidence }] });
  assert.equal(result.verificationStatus, 'needs_review');
  assert.deepEqual(result.unsupportedClaims, generated.unsupportedClaims);
});
