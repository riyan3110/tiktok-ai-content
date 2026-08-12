const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/autoSourceFinalizer');
const fastDiscovery = require('../src/services/autoSourceFastDiscovery');
const { compose } = require('../src/services/autoSourceComposer');

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

test('fast composer skips the generic generation call', async () => {
  const evidence = 'Robot humanoid menggunakan sensor dan aktuator untuk membantu mengendalikan gerakan tubuh.';
  const slideBodies = [
    'Sensor membantu robot humanoid membaca kondisi lingkungan sebelum menentukan gerakan tubuh berikutnya.',
    'Aktuator mengubah perintah sistem menjadi gerakan fisik pada bagian tubuh robot humanoid.',
    'Perangkat lunak mengoordinasikan sensor dan aktuator agar gerakan robot tetap terkendali selama operasi.',
    'Pengujian keseimbangan membantu pengembang menilai kestabilan robot saat bergerak di permukaan berbeda.'
  ];
  let generateCalls = 0;
  let finalizeCalls = 0;
  const fakeContent = {
    generateContent: async () => { generateCalls += 1; throw new Error('should not run'); },
    validateContent: () => [],
    validateSourceGrounding: () => []
  };
  const finalContent = {
    focus: { masalah: 'Robot humanoid', penyebab: 'Robot humanoid', solusi: 'Robot humanoid', hasil: 'Robot humanoid' },
    topic: 'Robot humanoid', hook: 'Robot humanoid bergerak dengan sensor', body: slideBodies[1], caption: slideBodies[1], hashtags: [], cta: 'Perkembangan robot humanoid',
    trendKeywordsUsed: [], content_angle: 'cara robot humanoid bergerak', primary_tool: 'tanpa tool', hook_pattern: 'source-grounded', verificationStatus: 'source_based', unsupportedClaims: [],
    slides: Array.from({ length: 4 }, (_, index) => ({
      section: ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'][index],
      title: `Robot humanoid ${index + 1}`,
      body: slideBodies[index],
      points: [],
      claims: [{ field: `slide:${index}:body`, text: slideBodies[index], sourceId: 'source-1', evidence }]
    }))
  };
  const fakeFinalizer = {
    rewriteAllSourcesWithAi: async () => { finalizeCalls += 1; return structuredClone(finalContent); },
    richnessErrors: () => []
  };
  const result = await compose({
    content: fakeContent,
    finalizer: fakeFinalizer,
    options: { requestedTopic: 'Robot humanoid', contentFormat: 'Fakta singkat', sourceContext: evidence, fastAutoSource: true },
    sources: [{ url: 'https://example.test/robot', title: 'Robot humanoid', text: evidence }]
  });
  assert.equal(generateCalls, 0);
  assert.equal(finalizeCalls, 1);
  assert.equal(result.sourceMode, 'auto');
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

test('version number is allowed when exact model token exists in the same source', () => {
  const content = {
    slides: [{
      title: 'Program keamanan baru OpenAI',
      body: 'OpenAI memperkenalkan GPT-5.6-Cyber lewat program Daybreak dengan akses Blue dan Red.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'OpenAI memperkenalkan GPT-5.6-Cyber lewat program Daybreak dengan akses Blue dan Red.',
        sourceId: 'source-1',
        evidence: 'OpenAI memperluas program keamanan siber Daybreak dengan dua tingkat akses, yaitu Blue dan Red.'
      }]
    }]
  };
  const sources = [{
    title: 'OpenAI launches GPT-5.6-Cyber for Daybreak',
    text: 'OpenAI memperkenalkan GPT-5.6-Cyber. Program keamanan siber Daybreak memiliki dua tingkat akses, Blue dan Red.'
  }];
  assert.deepEqual(finalizer.numericGroundingErrors(content, sources), []);
});

test('invented numeric shorthand remains rejected when absent from evidence and source', () => {
  const content = {
    slides: [{
      title: 'Bantuan AI harian',
      body: 'Bantuan 24/7 tersedia lewat AI.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'Bantuan 24/7 tersedia lewat AI.',
        sourceId: 'source-1',
        evidence: 'Get everyday help from Google AI.'
      }]
    }]
  };
  const sources = [{ title: 'Google AI help', text: 'Get everyday help from Google AI.' }];
  assert.equal(finalizer.numericGroundingErrors(content, sources).length, 2);
});

test('title and body may share product name when body adds substantive facts', () => {
  const content = {
    slides: [{
      title: 'iQOO Neo 11 resmi meluncur',
      body: 'iQOO Neo 11 membawa layar AMOLED baru, chipset flagship, dan baterai berkapasitas besar.',
      points: []
    }]
  };
  const errors = ['slide:0:body: copy mengulang title.'];
  assert.deepEqual(finalizer.filterFalsePositiveDuplicateErrors(errors, content), []);
});

test('near-identical title and body are still rejected as duplicate', () => {
  const content = {
    slides: [{
      title: 'iQOO Neo 11 resmi meluncur',
      body: 'iQOO Neo 11 resmi meluncur hari ini.',
      points: []
    }]
  };
  const errors = ['slide:0:body: copy mengulang title.'];
  assert.deepEqual(finalizer.filterFalsePositiveDuplicateErrors(errors, content), errors);
});
