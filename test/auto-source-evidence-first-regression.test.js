const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const routing = require('../src/services/autoSourceRoutingComposer');
const patch = require('../src/services/autoSourcePatch');

function source(title, text, url, evidenceMode) {
  return {
    title,
    text,
    url,
    finalUrl: url,
    discovery: evidenceMode ? { evidenceMode } : {}
  };
}

test('near-identical announcement sentences do not count as four distinct carousel facts', () => {
  const sources = [source(
    'Meta launches Muse Glimmer',
    [
      'Meta launched Muse Glimmer for developers on Monday.',
      'Meta released Muse Glimmer for developers on Monday.',
      'Meta introduced Muse Glimmer for developers on Monday.',
      'Meta announced Muse Glimmer for developers on Monday.'
    ].join(' '),
    'https://example.test/meta'
  )];

  assert.ok(routing.distinctFactCount('Meta Muse Glimmer', sources) < 4);
});

test('four substantively different facts are accepted even when they come from one strong full article', () => {
  const sources = [source(
    'Meta launches Muse Glimmer',
    [
      'Meta released Muse Glimmer as an open-weight AI model.',
      'The model is designed for smaller agentic tasks on personal devices.',
      'It can run using a single graphics card on a personal computer.',
      'Developers can use the released model weights to build local applications.'
    ].join(' '),
    'https://example.test/reuters-like'
  )];

  assert.equal(routing.distinctFactCount('Meta Muse Glimmer', sources), 4);
});

test('prepareSources keeps search snippets out when full articles already provide four distinct facts', () => {
  const full = source(
    'Muse Glimmer details',
    [
      'Muse Glimmer is an open-weight AI model from Meta.',
      'The model targets smaller agentic tasks on personal devices.',
      'The model can run using one graphics card.',
      'The released weights can be used by developers for local applications.'
    ].join(' '),
    'https://news.example/full'
  );
  const snippet = source(
    'Muse Glimmer rumor summary',
    'A search snippet mentions another specification for Muse Glimmer.',
    'https://snippet.example/result',
    'search-snippet'
  );
  const plan = { rawTopic: 'Muse Glimmer', canonicalTopic: 'Muse Glimmer', subjects: [], eventTerms: [], contextTerms: [] };

  const prepared = routing.prepareSources('Muse Glimmer', [full, snippet], plan);
  assert.ok(prepared.length >= 1);
  assert.ok(prepared.every(item => item.discovery?.evidenceMode !== 'search-snippet'));
});

test('pruneNearDuplicateFacts removes repeated launch wording before simple writer sees sources', () => {
  const first = source(
    'Muse Glimmer launch',
    [
      'Meta launched Muse Glimmer for developers on Monday.',
      'Muse Glimmer is an open-weight AI model.',
      'The model can run on one graphics card.'
    ].join(' '),
    'https://one.example/article'
  );
  const second = source(
    'Muse Glimmer release',
    [
      'Meta released Muse Glimmer for developers on Monday.',
      'The model is designed for smaller agentic tasks on personal devices.'
    ].join(' '),
    'https://two.example/article'
  );
  const plan = { rawTopic: 'Muse Glimmer', canonicalTopic: 'Muse Glimmer', subjects: [], eventTerms: [], contextTerms: [] };
  const pruned = routing.pruneNearDuplicateFacts('Muse Glimmer', [first, second], plan);
  const combined = pruned.map(item => item.text).join(' ');

  assert.match(combined, /open-weight/i);
  assert.match(combined, /graphics card/i);
  assert.match(combined, /personal devices/i);
  assert.ok(!(combined.includes('launched Muse Glimmer') && combined.includes('released Muse Glimmer')));
});

test('ensureDistinctEvidence searches again before writing when initial evidence would repeat slides', async () => {
  let expandedCalls = 0;
  const initial = {
    topic: 'Topik terbaru',
    sources: [source('Initial source', 'Fakta awal.', 'https://example.test/initial')],
    topicPlan: { canonicalTopic: 'Topik terbaru', subjects: ['Produk'], contextTerms: ['fitur'], eventTerms: ['fitur'] }
  };
  const expandedSource = source('Expanded source', 'Fakta tambahan.', 'https://example.test/expanded');
  const composer = {
    REQUIRED_DISTINCT_FACTS: 4,
    prepareSources: (_topic, sources) => sources,
    distinctFactCount: (_topic, sources) => sources.length >= 2 ? 4 : 1
  };
  const planner = {
    verbLike: () => false,
    createPlan: async () => initial.topicPlan
  };
  const result = await patch.ensureDistinctEvidence({
    topic: 'Topik terbaru',
    category: 'Teknologi',
    discovery: initial,
    sourceFetcher: {},
    expandedDiscovery: {
      discover: async () => {
        expandedCalls += 1;
        return { topic: 'Topik terbaru', sources: [expandedSource], queries: ['detail'], providers: ['test'] };
      }
    },
    topicPlanner: planner,
    autoSourceComposer: composer
  });

  assert.equal(expandedCalls, 1);
  assert.equal(result.scopeMode, 'distinct-fact-recovery');
  assert.equal(result.sources.length, 2);
  assert.ok(result.sources.some(item => item.finalUrl === 'https://example.test/initial'));
  assert.ok(result.sources.some(item => item.finalUrl === 'https://example.test/expanded'));
});

test('fact expansion plan remains generic and current without any topic whitelist', () => {
  const planner = { verbLike: value => /^launch$/i.test(String(value)) };
  const plan = patch.makeFactExpansionPlan('Produk X launch fitur Y', {
    canonicalTopic: 'Produk X launch fitur Y',
    subjects: ['Produk X'],
    actionTerms: ['launch'],
    contextTerms: ['fitur Y'],
    eventTerms: ['launch', 'fitur Y'],
    searchQueries: ['Produk X fitur Y latest']
  }, planner);

  assert.deepEqual(plan.actionTerms, []);
  assert.ok(plan.searchQueries.some(query => /details/i.test(query)));
  assert.ok(plan.searchQueries.some(query => /official announcement/i.test(query)));
  assert.equal(plan.evidenceIntent, 'distinct-facts');
});
