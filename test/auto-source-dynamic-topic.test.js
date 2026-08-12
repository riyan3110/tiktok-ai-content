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
      searchQueries: [topic, 'AetherNova NovaKite ZX-9 data center launch'],
      marketIntent: false,
      relation: 'event'
    })
  });

  assert.deepEqual(plan.subjects, ['AetherNova', 'NovaKite ZX-9']);
  assert.ok(plan.searchQueries.some(query => query.includes('NovaKite ZX-9')));
  assert.equal(plan.marketIntent, false);
});

test('fallback planner also preserves unknown names and version strings', () => {
  const plan = planner.fallbackPlan('AetherNova meluncurkan NovaKite ZX-9');
  assert.ok(plan.subjects.some(subject => /AetherNova/i.test(subject)));
  assert.ok(plan.subjects.some(subject => /NovaKite ZX-9/i.test(subject)));
  assert.ok(plan.searchQueries[0].includes('NovaKite ZX-9'));
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

test('exact topic does not pay for an alternate search when enough strong sources already exist', async () => {
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
