const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/autoSourceFinalizer');
const fastDiscovery = require('../src/services/autoSourceFastDiscovery');

function baseContent(title, point, evidence) {
  return {
    slides: [{
      section: 'FAKTA UTAMA',
      title,
      body: 'Google AI membantu pengguna menangani berbagai tugas sehari-hari.',
      points: [point],
      claims: [
        { field: 'slide:0:title', text: title, sourceId: 'source-1', evidence },
        { field: 'slide:0:body', text: 'Google AI membantu pengguna menangani berbagai tugas sehari-hari.', sourceId: 'source-1', evidence },
        { field: 'slide:0:point:0', text: point, sourceId: 'source-1', evidence }
      ]
    }]
  };
}

test('everyday evidence repairs unsupported 24/7 shorthand without another model call', () => {
  const evidence = 'Get everyday help from Google AI to tackle tasks at work, school or home.';
  const content = baseContent('Bantuan Google AI', 'Bantuan 24/7 via AI', evidence);
  finalizer.repairKnownNumericShorthand(content);
  assert.equal(content.slides[0].points[0], 'Bantuan setiap hari via AI');
  assert.equal(content.slides[0].claims[2].text, 'Bantuan setiap hari via AI');
});

test('privacy product copy is not treated as website privacy-policy boilerplate', () => {
  const evidence = 'Meta added privacy controls for account activity.';
  const content = baseContent('Kontrol privasi Meta diperluas', 'Kontrol aktivitas akun', evidence);
  const errors = ['slide:0:title: metadata/boilerplate website masuk ke konten.'];
  assert.deepEqual(finalizer.filterFalsePositiveMetadataErrors(errors, content), []);
});

test('actual privacy policy boilerplate is still rejected', () => {
  const evidence = 'Privacy Policy';
  const content = baseContent('Kebijakan Privasi', 'Baca kebijakan situs', evidence);
  const errors = ['slide:0:title: metadata/boilerplate website masuk ke konten.'];
  assert.deepEqual(finalizer.filterFalsePositiveMetadataErrors(errors, content), errors);
});

test('auto source finalizer uses at most two rewrite attempts', () => {
  assert.equal(finalizer.MAX_AUTO_FINALIZE_ATTEMPTS, 2);
});

test('fast discovery runs independent query searches concurrently', async () => {
  fastDiscovery.clearCache();
  let active = 0;
  let maxActive = 0;
  const searchImpl = async query => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active -= 1;
    return [{
      title: `${query} overview`,
      url: `https://example.com/${encodeURIComponent(query)}`,
      description: `${query} factual overview`,
      provider: 'test'
    }];
  };
  const sourceFetcher = {
    fetchSources: async urls => [{
      url: urls[0], finalUrl: urls[0], title: 'Robot humanoid overview',
      text: 'Robot humanoid memiliki tubuh berartikulasi dan menggunakan sensor untuk membantu menjaga keseimbangan. Robot humanoid diuji untuk pekerjaan fisik di lingkungan industri dan penelitian. Sistem robot menggunakan aktuator dan perangkat lunak untuk mengendalikan gerakan tubuh.',
      fetchedAt: '2026-08-12T00:00:00.000Z'
    }],
    validateUrl: async raw => new URL(raw)
  };
  await fastDiscovery.discover({
    topic: 'Robot humanoid',
    category: 'Edukasi teknologi',
    searchImpl,
    sourceFetcher,
    now: () => Date.parse('2026-08-12T00:00:00.000Z')
  });
  assert.ok(maxActive >= 2, `expected concurrent searches, got ${maxActive}`);
});
