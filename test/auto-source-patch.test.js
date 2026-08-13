const test = require('node:test');
const assert = require('node:assert/strict');

const generation = require('../src/services/generation');
const autoSourcePatch = require('../src/services/autoSourcePatch');
const { autoSourceRequested, pakaiUrlRequested } = autoSourcePatch;

const AUTO_SOURCE_MODULES = [
  '../src/services/autoSourceFastDiscovery',
  '../src/services/autoSourceExpandedDiscovery',
  '../src/services/autoSourceScopedDiscovery',
  '../src/services/autoSourceTopicIdentity',
  '../src/services/autoSourceMultiEntityTopic',
  '../src/services/autoSourceTopicScope',
  '../src/services/autoSourceDynamicTopicPlan',
  '../src/services/autoSourceDynamicScope',
  '../src/services/autoSourceStoryFocus',
  '../src/services/autoSourceQualityLayer',
  '../src/services/autoSourceRuntimeGuard',
  '../src/services/autoSourcePlanFinalizer',
  '../src/services/autoSourceStrictFinalizer',
  '../src/services/autoSourceComposer',
  '../src/services/autoSourceSimpleComposer',
  '../src/services/autoSourceResearchComposer',
  '../src/services/autoSourceTopicLockedComposer',
  '../src/services/autoSourceMultiEntityComposer',
  '../src/services/autoSourceRoutingComposer',
  '../src/services/autoSourceVisualFit'
];

function clearAutoSourceCaches() {
  for (const modulePath of AUTO_SOURCE_MODULES) {
    try { delete require.cache[require.resolve(modulePath)]; } catch {}
  }
}

test('manual Tanpa URL is now Generate dari Teks when useSources=false', () => {
  assert.equal(autoSourceRequested({ mode: 'manual', useSources: false, sourceUrls: [] }), true);
});

test('manual Pakai URL stays on the existing URL path', () => {
  const args = { mode: 'manual', useSources: true, sourceUrls: ['https://example.test/article'] };
  assert.equal(pakaiUrlRequested(args), true);
  assert.equal(autoSourceRequested(args), false);
});

test('manual Pakai URL with an empty field is still handled by the existing URL validation path', () => {
  const args = { mode: 'manual', useSources: true, sourceUrls: [] };
  assert.equal(pakaiUrlRequested(args), true);
  assert.equal(autoSourceRequested(args), false);
});

test('supplied URL never enters text mode even if a caller forgets useSources=true', () => {
  const args = { mode: 'manual', useSources: false, sourceUrls: ['https://example.test/article'] };
  assert.equal(pakaiUrlRequested(args), true);
  assert.equal(autoSourceRequested(args), false);
});

test('automatic AI topic mode without URLs is not hijacked by manual text mode', () => {
  assert.equal(autoSourceRequested({ mode: 'ai', useSources: false, sourceUrls: [] }), false);
});

test('scoped Auto Source loader remains available without installing legacy strict/plan validator stack', () => {
  clearAutoSourceCaches();
  const dependencies = autoSourcePatch.loadAutoSourceDependencies();
  assert.ok(dependencies.autoSourceDiscovery);
  assert.ok(dependencies.expandedDiscovery);
  assert.ok(dependencies.topicPlanner);
  assert.ok(dependencies.autoSourceComposer);
  assert.ok(dependencies.autoSourceVisualFit);
  assert.equal('autoSourcePlanFinalizer' in dependencies, false);
  assert.equal(require.cache[require.resolve('../src/services/autoSourceQualityLayer')], undefined);
  assert.equal(require.cache[require.resolve('../src/services/autoSourceRuntimeGuard')], undefined);
  assert.equal(require.cache[require.resolve('../src/services/autoSourcePlanFinalizer')], undefined);
  assert.equal(require.cache[require.resolve('../src/services/autoSourceStrictFinalizer')], undefined);
});

test('Pakai URL is exact pass-through to the pre-text-mode generator', async () => {
  autoSourcePatch.resetForTests();
  clearAutoSourceCaches();
  try { delete require.cache[require.resolve('../src/services/textInputComposer')]; } catch {}
  const realGenerateAndSave = generation.generateAndSave;
  const args = {
    mode: 'manual',
    useSources: true,
    sourceUrls: ['https://example.test/article'],
    requestedTopic: 'Topik URL baseline',
    sentinel: { keep: 'same-object' }
  };
  let received = null;
  let calls = 0;

  generation.generateAndSave = async value => {
    calls += 1;
    received = value;
    return 155;
  };

  try {
    const wrapped = autoSourcePatch.install();
    const result = await wrapped(args);

    assert.equal(result, 155);
    assert.equal(calls, 1);
    assert.strictEqual(received, args, 'Pakai URL args must be forwarded without cloning or rewriting');
    assert.equal(require.cache[require.resolve('../src/services/textInputComposer')], undefined);
    for (const modulePath of AUTO_SOURCE_MODULES) {
      assert.equal(require.cache[require.resolve(modulePath)], undefined, `${modulePath} must stay unloaded for Pakai URL`);
    }
  } finally {
    autoSourcePatch.resetForTests();
    generation.generateAndSave = realGenerateAndSave;
  }
});

test('production manual no-URL uses pasted text without source discovery or trend injection', async () => {
  autoSourcePatch.resetForTests();
  clearAutoSourceCaches();
  const realGenerateAndSave = generation.generateAndSave;
  let receivedGeneration = null;

  generation.generateAndSave = async options => {
    receivedGeneration = options;
    return 201;
  };

  try {
    const wrapped = autoSourcePatch.install();
    const result = await wrapped({
      mode: 'manual',
      useSources: false,
      sourceUrls: [],
      requestedTopic: 'Ringkasan berita yang cukup panjang untuk disusun ulang menjadi carousel tanpa pencarian sumber baru dan tanpa menambahkan fakta dari luar teks pengguna.'
    });

    assert.equal(result, 201);
    assert.equal(receivedGeneration.useSources, false);
    assert.deepEqual(receivedGeneration.sourceUrls, []);
    assert.equal(receivedGeneration.useTrendReference, false);
    assert.equal(typeof receivedGeneration.content.generateContent, 'function');
    for (const modulePath of AUTO_SOURCE_MODULES) {
      assert.equal(require.cache[require.resolve(modulePath)], undefined, `${modulePath} must stay unloaded for Generate dari Teks`);
    }
  } finally {
    autoSourcePatch.resetForTests();
    generation.generateAndSave = realGenerateAndSave;
  }
});

test('current-topic recovery keeps subject and context but relaxes only literal action wording', () => {
  const planner = { verbLike: value => ['menerapkan', 'meluncurkan'].includes(String(value).toLowerCase()) };
  const plan = autoSourcePatch.makeCurrentTopicRecoveryPlan('Produk menerapkan penanda konten', {
    canonicalTopic: 'Produk menerapkan penanda konten',
    subjects: ['Produk'],
    actionTerms: ['menerapkan'],
    contextTerms: ['penanda konten', 'watermark'],
    eventTerms: ['menerapkan', 'watermark'],
    searchQueries: ['Produk menerapkan penanda konten'],
    relation: 'event',
    planner: 'ai'
  }, planner);

  assert.deepEqual(plan.subjects, ['Produk']);
  assert.deepEqual(plan.actionTerms, []);
  assert.ok(plan.contextTerms.includes('watermark'));
  assert.ok(plan.searchQueries.some(query => /latest news/i.test(query)));
  assert.ok(plan.searchQueries.some(query => /terbaru/i.test(query)));
  assert.equal(plan.planner, 'ai');
});

test('recoverable no-URL discovery helper still retries fresh runtime topic through expanded discovery', async () => {
  const calls = [];
  const primaryError = Object.assign(new Error('current source too strict'), {
    status: 422,
    code: 'AUTO_SOURCE_RELEVANT_SOURCE_EMPTY'
  });
  const autoSourceDiscovery = {
    discover: async options => {
      calls.push(['primary', options]);
      throw primaryError;
    }
  };
  const topicPlanner = {
    verbLike: value => String(value).toLowerCase() === 'menerapkan',
    createPlan: async topic => ({
      rawTopic: topic,
      canonicalTopic: 'Produk menerapkan watermark',
      subjects: ['Produk'],
      actionTerms: ['menerapkan'],
      contextTerms: ['watermark'],
      eventTerms: ['menerapkan', 'watermark'],
      searchQueries: ['Produk watermark latest'],
      relation: 'event',
      planner: 'ai'
    })
  };
  const expandedDiscovery = {
    discover: async options => {
      calls.push(['recovery', options]);
      assert.deepEqual(options.topicPlan.subjects, ['Produk']);
      assert.deepEqual(options.topicPlan.actionTerms, []);
      assert.ok(options.topicPlan.contextTerms.includes('watermark'));
      assert.ok(options.topicPlan.searchQueries.some(query => /latest/i.test(query)));
      return {
        topic: options.topic,
        queries: options.topicPlan.searchQueries,
        providers: ['fresh-news-test'],
        sources: [{
          title: 'Current article about the requested product and watermark',
          text: 'The current source says the product plans to add a watermark to generated content.',
          url: 'https://example.test/current',
          finalUrl: 'https://example.test/current'
        }]
      };
    }
  };

  const result = await autoSourcePatch.discoverCurrentSources({
    topic: 'Produk menerapkan watermark',
    category: 'Edukasi teknologi',
    sourceFetcher: {},
    autoSourceDiscovery,
    expandedDiscovery,
    topicPlanner
  });

  assert.equal(calls.length, 2);
  assert.equal(result.scopeMode, 'current-topic-recovery');
  assert.equal(result.recoveryFrom, 'AUTO_SOURCE_RELEVANT_SOURCE_EMPTY');
  assert.equal(result.sources[0].finalUrl, 'https://example.test/current');
});

test('successful discovery helper never invokes the recovery path', async () => {
  let plannerCalls = 0;
  let recoveryCalls = 0;
  const expected = {
    topic: 'Topik apa pun',
    sources: [{ finalUrl: 'https://example.test/normal' }]
  };
  const result = await autoSourcePatch.discoverCurrentSources({
    topic: 'Topik apa pun',
    autoSourceDiscovery: { discover: async () => expected },
    expandedDiscovery: { discover: async () => { recoveryCalls += 1; return null; } },
    topicPlanner: { createPlan: async () => { plannerCalls += 1; return {}; } }
  });

  assert.strictEqual(result, expected);
  assert.equal(plannerCalls, 0);
  assert.equal(recoveryCalls, 0);
});

test('non-recoverable discovery error is not broadened or retried', async () => {
  let plannerCalls = 0;
  let recoveryCalls = 0;
  const failure = Object.assign(new Error('provider auth failed'), { status: 401 });

  await assert.rejects(() => autoSourcePatch.discoverCurrentSources({
    topic: 'Topik apa pun',
    autoSourceDiscovery: { discover: async () => { throw failure; } },
    expandedDiscovery: { discover: async () => { recoveryCalls += 1; return null; } },
    topicPlanner: { createPlan: async () => { plannerCalls += 1; return {}; } }
  }), error => error === failure);

  assert.equal(plannerCalls, 0);
  assert.equal(recoveryCalls, 0);
});
