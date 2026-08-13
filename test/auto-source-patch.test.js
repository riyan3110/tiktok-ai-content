const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

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

test('manual Tanpa URL activates auto source even when legacy UI sends useSources=false', () => {
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

test('supplied URL never enters Auto Source even if a caller forgets useSources=true', () => {
  const args = { mode: 'manual', useSources: false, sourceUrls: ['https://example.test/article'] };
  assert.equal(pakaiUrlRequested(args), true);
  assert.equal(autoSourceRequested(args), false);
});

test('automatic AI topic mode without URLs is not hijacked by manual auto source', () => {
  assert.equal(autoSourceRequested({ mode: 'ai', useSources: false, sourceUrls: [] }), false);
});

test('scoped Auto Source loader does not install legacy strict/plan validator stack', () => {
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

test('Pakai URL is exact pass-through to the pre-Auto-Source generator', async () => {
  autoSourcePatch.resetForTests();
  clearAutoSourceCaches();
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
    for (const modulePath of AUTO_SOURCE_MODULES) {
      assert.equal(require.cache[require.resolve(modulePath)], undefined, `${modulePath} must stay unloaded for Pakai URL`);
    }
  } finally {
    autoSourcePatch.resetForTests();
    generation.generateAndSave = realGenerateAndSave;
  }
});

test('production manual Tanpa URL enables topic interpretation before discovery', async () => {
  autoSourcePatch.resetForTests();
  clearAutoSourceCaches();
  const realGenerateAndSave = generation.generateAndSave;
  const scopedDiscovery = require('../src/services/autoSourceScopedDiscovery');
  const realDiscover = scopedDiscovery.discover;
  let receivedDiscovery = null;
  let receivedGeneration = null;

  scopedDiscovery.discover = async options => {
    receivedDiscovery = options;
    return {
      topic: options.topic,
      queries: [options.topic],
      providers: ['test'],
      sources: [{
        title: 'Topik terbaru yang sesuai',
        text: 'Sumber memuat fakta yang sesuai topik dan cukup panjang untuk proses penulisan carousel.',
        url: 'https://example.test/relevant',
        finalUrl: 'https://example.test/relevant'
      }]
    };
  };
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
      requestedTopic: 'Topik berita bebas terbaru'
    });

    assert.equal(result, 201);
    assert.equal(receivedDiscovery.interpretTopic, true);
    assert.equal(receivedDiscovery.topic, 'Topik berita bebas terbaru');
    assert.equal(receivedGeneration.useSources, true);
  } finally {
    autoSourcePatch.resetForTests();
    generation.generateAndSave = realGenerateAndSave;
    scopedDiscovery.discover = realDiscover;
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

test('recoverable no-URL discovery failure retries fresh runtime topic through expanded discovery', async () => {
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

test('successful normal no-URL discovery never invokes the recovery path', async () => {
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
