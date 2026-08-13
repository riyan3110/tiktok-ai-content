const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const planner = require('../src/services/autoSourceDynamicTopicPlan');
const scope = require('../src/services/autoSourceDynamicScope');
const expanded = require('../src/services/autoSourceExpandedDiscovery');
const scoped = require('../src/services/autoSourceScopedDiscovery');

function fakePlannerClient(payload) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(payload) } }]
        })
      }
    }
  };
}

test('runtime planner understands a never-before-seen trending product without code aliases', async () => {
  const topic = 'AetherNova memperkenalkan NovaKite ZX-9 untuk pusat data';
  const plan = await planner.createPlan(topic, {
    client: fakePlannerClient({
      canonicalTopic: topic,
      subjects: ['AetherNova', 'NovaKite ZX-9'],
      eventTerms: ['memperkenalkan', 'pusat data', 'launch', 'data center'],
      actionTerms: ['memperkenalkan', 'launch'],
      contextTerms: ['pusat data', 'data center'],
      searchQueries: [topic, 'AetherNova NovaKite ZX-9 data center launch'],
      marketIntent: false,
      relation: 'event'
    })
  });

  assert.deepEqual(plan.subjects, ['AetherNova', 'NovaKite ZX-9']);
  assert.ok(plan.searchQueries.some(query => query.includes('NovaKite ZX-9')));
  assert.ok(plan.actionTerms.includes('launch'));
  assert.equal(plan.marketIntent, false);
});

test('fallback planner also preserves unknown names and version strings', () => {
  const plan = planner.fallbackPlan('AetherNova meluncurkan NovaKite ZX-9');
  assert.ok(plan.subjects.some(subject => /AetherNova/i.test(subject)));
  assert.ok(plan.subjects.some(subject => /NovaKite ZX-9/i.test(subject)));
  assert.ok(plan.actionTerms.some(term => /meluncurkan/i.test(term)));
  assert.ok(plan.searchQueries[0].includes('NovaKite ZX-9'));
});

test('reader-facing commands are never mistaken for the news subject', () => {
  const plan = planner.fallbackPlan('Kenali waktu ChatGPT riset pemikiran');
  assert.deepEqual(plan.subjects, ['ChatGPT']);
  assert.ok(!plan.eventTerms.some(term => /^kenali$/i.test(term)));
  assert.ok(plan.contextTerms.some(term => /riset/i.test(term)));

  const generic = planner.fallbackPlan('Pahami teknologi');
  assert.ok(!generic.subjects.some(term => /^pahami$/i.test(term)));
  assert.ok(!generic.eventTerms.some(term => /^pahami$/i.test(term)));
});

test('dynamic scope keeps novel-topic facts and rejects unrelated side notes', () => {
  const topic = 'AetherNova memperkenalkan NovaKite ZX-9 untuk pusat data';
  const plan = {
    subjects: ['AetherNova', 'NovaKite ZX-9'],
    eventTerms: ['memperkenalkan', 'launch', 'pusat data', 'data center'],
    marketIntent: false,
    planner: 'test'
  };
  const source = {
    title: 'AetherNova launches NovaKite ZX-9 for data centers',
    text: 'AetherNova launched NovaKite ZX-9 for data centers. The system targets dense AI infrastructure. Gold rose 1.2% while Bitcoin slipped.'
  };

  assert.equal(scope.sourceInScope(topic, source, plan), true);
  assert.equal(scope.evidenceInScope(topic, 'AetherNova launched NovaKite ZX-9 for data centers.', source, plan), true);
  assert.equal(scope.evidenceInScope(topic, 'Gold rose 1.2% while Bitcoin slipped.', source, plan), false);

  const narrowed = scope.scopeSource(topic, source, plan);
  assert.match(narrowed.text, /NovaKite ZX-9/);
  assert.doesNotMatch(narrowed.text, /Bitcoin/);
});

test('scoped discovery broadens with a runtime-generated query only when exact topic is weak', async () => {
  const original = expanded.discover;
  const calls = [];
  expanded.discover = async ({ topic }) => {
    calls.push(topic);
    if (topic === 'AetherNova memperkenalkan NovaKite ZX-9') {
      return { topic, sources: [], queries: [topic], providers: ['test'], publishers: [] };
    }
    return {
      topic,
      queries: [topic],
      providers: ['test'],
      publishers: ['example.test'],
      sources: [{
        title: 'AetherNova launches NovaKite ZX-9',
        text: 'AetherNova launched NovaKite ZX-9 for new AI infrastructure.',
        url: 'https://example.test/novakite',
        finalUrl: 'https://example.test/novakite',
        discovery: { publisher: 'example.test' }
      }]
    };
  };

  try {
    const topic = 'AetherNova memperkenalkan NovaKite ZX-9';
    const result = await scoped.discover({
      topic,
      topicPlannerClient: fakePlannerClient({
        canonicalTopic: topic,
        subjects: ['AetherNova', 'NovaKite ZX-9'],
        eventTerms: ['memperkenalkan', 'launch'],
        actionTerms: ['memperkenalkan', 'launch'],
        contextTerms: [],
        searchQueries: [topic, 'AetherNova NovaKite ZX-9 launch'],
        marketIntent: false,
        relation: 'event'
      })
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[1], 'AetherNova NovaKite ZX-9 launch');
    assert.equal(result.sources.length, 1);
    assert.equal(result.topicPlan.subjects[1], 'NovaKite ZX-9');
  } finally {
    expanded.discover = original;
  }
});

test('exact topic does not run another web search when fetched sources become strong after runtime interpretation', async () => {
  const original = expanded.discover;
  let calls = 0;
  expanded.discover = async ({ topic }) => {
    calls += 1;
    return {
      topic,
      queries: [topic],
      providers: ['test'],
      publishers: ['a.test', 'b.test', 'c.test'],
      sources: ['a','b','c'].map(name => ({
        title: `AetherNova NovaKite ZX-9 launch ${name}`,
        text: `AetherNova launched NovaKite ZX-9 for data center infrastructure ${name}.`,
        url: `https://${name}.test/story`,
        finalUrl: `https://${name}.test/story`,
        discovery: { publisher: `${name}.test` }
      }))
    };
  };

  try {
    const topic = 'AetherNova memperkenalkan NovaKite ZX-9';
    const result = await scoped.discover({
      topic,
      topicPlannerClient: fakePlannerClient({
        canonicalTopic: topic,
        subjects: ['AetherNova', 'NovaKite ZX-9'],
        eventTerms: ['memperkenalkan', 'launch'],
        actionTerms: ['memperkenalkan', 'launch'],
        contextTerms: [],
        searchQueries: [topic, 'AetherNova NovaKite ZX-9 launch'],
        marketIntent: false,
        relation: 'event'
      })
    });
    assert.equal(calls, 1);
    assert.equal(result.sources.length, 3);
  } finally {
    expanded.discover = original;
  }
});

test('production interpretation rejects a same-brand pricing article and retries the intended research query', async () => {
  const original = expanded.discover;
  const topic = 'Kenali waktu ChatGPT riset pemikiran';
  const retryQuery = 'ChatGPT when to use deep research versus thinking mode';
  const calls = [];
  const wrong = {
    title: 'Perbedaan ChatGPT Pro, Plus, dan Go: Kenali Fitur dan Harganya',
    text: 'ChatGPT menawarkan beberapa paket berlangganan. Setiap paket memiliki harga berbeda. Paket Pro ditujukan untuk pekerjaan intensif. Paket Plus menawarkan fitur tambahan. Daftar paket juga menyebut deep research dan Thinking mode sebagai bagian dari fitur.',
    url: 'https://wrong.test/chatgpt-plans',
    finalUrl: 'https://wrong.test/chatgpt-plans',
    discovery: { publisher: 'wrong.test', score: 30 }
  };
  const correct = {
    title: 'When to use ChatGPT deep research versus Thinking mode',
    text: 'Deep research is useful for multi-step questions that synthesize multiple sources. Thinking mode reasons through complex prompts without producing a sourced research report. Standard chat is faster for quick lookups. Deep research lets users choose sources. A research task can take longer to complete.',
    url: 'https://right.test/chatgpt-research-thinking',
    finalUrl: 'https://right.test/chatgpt-research-thinking',
    discovery: { publisher: 'right.test', score: 20 }
  };

  expanded.discover = async ({ topic: query }) => {
    calls.push(query);
    const sources = query === topic ? [wrong] : [correct];
    return {
      topic: query,
      queries: [query],
      providers: ['test'],
      publishers: sources.map(source => source.discovery.publisher),
      sources
    };
  };

  try {
    const result = await scoped.discover({
      topic,
      interpretTopic: true,
      topicPlannerClient: fakePlannerClient({
        canonicalTopic: 'Kapan memakai ChatGPT untuk riset mendalam atau mode berpikir',
        subjects: ['ChatGPT'],
        eventTerms: ['deep research versus thinking mode', 'riset mendalam atau mode berpikir'],
        actionTerms: [],
        contextTerms: ['deep research', 'thinking mode'],
        searchQueries: [topic, retryQuery],
        marketIntent: false,
        relation: 'comparison'
      })
    });

    assert.deepEqual(calls, [topic, retryQuery]);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].finalUrl, correct.finalUrl);
    assert.ok(!result.sources.some(source => source.finalUrl === wrong.finalUrl));
    assert.equal(result.scopeMode, 'strict-alternate');
  } finally {
    expanded.discover = original;
  }
});
