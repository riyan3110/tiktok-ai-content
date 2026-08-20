const test = require('node:test');
const assert = require('node:assert/strict');

const expanded = require('../src/services/autoSourceExpandedDiscovery');
const scoped = require('../src/services/autoSourceScopedDiscovery');

function bundle(topic, sources) {
  return {
    topic,
    searchedAt: '2026-08-13T00:00:00.000Z',
    queries: [topic],
    providers: ['test'],
    publishers: sources.map((_, index) => `p${index}.test`),
    sources
  };
}

function fakePlannerClient(payload) {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] })
      }
    }
  };
}

test('generic discovery drops a search hit whose fetched article is off-topic', async () => {
  const original = expanded.discover;
  expanded.discover = async () => bundle('Aplikasi Gemini', [
    {
      title: 'Gemini app update',
      text: 'Gemini adds a new feature for users. Gemini can connect with selected Google services.',
      url: 'https://good.test/gemini',
      discovery: { publisher: 'good.test' }
    },
    {
      title: 'Google headphone refresh',
      text: 'Google refreshed its headphones with new controls and battery improvements.',
      url: 'https://bad.test/headphones',
      discovery: { publisher: 'bad.test' }
    }
  ]);
  try {
    const result = await scoped.discover({ topic: 'Aplikasi Gemini' });
    assert.equal(result.sources.length, 1);
    assert.match(result.sources[0].title, /Gemini/i);
  } finally { expanded.discover = original; }
});

test('interpreted soft fallback never downgrades to a same-brand article with a different main story', () => {
  const topic = 'Kenali waktu ChatGPT riset pemikiran';
  const plan = {
    canonicalTopic: 'Kapan memakai ChatGPT untuk riset mendalam atau mode berpikir',
    subjects: ['ChatGPT'],
    eventTerms: ['deep research versus thinking mode', 'riset mendalam atau mode berpikir'],
    actionTerms: [],
    contextTerms: ['deep research', 'thinking mode'],
    searchQueries: [topic, 'ChatGPT when to use deep research versus thinking mode'],
    marketIntent: false,
    relation: 'comparison',
    planner: 'ai'
  };
  const pricingArticle = {
    title: 'Perbedaan ChatGPT Pro, Plus, dan Go: Kenali Fitur dan Harganya',
    text: 'ChatGPT menawarkan beberapa paket. Harga paket berbeda. Paket Pro ditujukan untuk penggunaan intensif. Paket Plus memiliki fitur tambahan. Daftar fitur juga menyebut deep research dan Thinking mode.',
    url: 'https://wrong.test/chatgpt-plans',
    finalUrl: 'https://wrong.test/chatgpt-plans',
    discovery: { publisher: 'wrong.test', score: 50 }
  };

  assert.equal(scoped.softSourceScore(topic, pricingArticle, plan), -1);
  assert.deepEqual(scoped.softRelevantSources(topic, [pricingArticle], plan), []);
});

test('generic discovery can dynamically bridge Indonesian topic wording to English sources', async () => {
  const original = expanded.discover;
  const topic = 'Potensi manfaat AI terhadap iklim';
  expanded.discover = async ({ topic: query }) => bundle(query, [
    {
      title: 'AI for climate forecasting',
      text: 'Artificial intelligence is used in climate forecasting and climate research.',
      url: 'https://climate.test/ai',
      discovery: { publisher: 'climate.test' }
    }
  ]);
  try {
    const result = await scoped.discover({
      topic,
      topicPlannerClient: fakePlannerClient({
        canonicalTopic: topic,
        subjects: [],
        eventTerms: ['AI', 'artificial intelligence', 'iklim', 'climate'],
        actionTerms: [],
        contextTerms: ['iklim', 'climate'],
        searchQueries: [topic, 'artificial intelligence climate benefits'],
        marketIntent: false,
        relation: 'general'
      })
    });
    assert.equal(result.sources.length, 1);
    assert.ok(result.topicPlan.searchQueries.some(query => /climate/i.test(query)));
  } finally { expanded.discover = original; }
});

test('event discovery falls back to a relevant article when action and context are split across the article', async () => {
  const original = expanded.discover;
  const topic = 'OpenAI sedang menguji fitur batasan penggunaan';
  const article = {
    title: 'OpenAI is testing a new ChatGPT option',
    text: [
      'OpenAI is testing a new option for some ChatGPT users.',
      'The control appears in account settings for selected users.',
      'A depleted weekly usage quota can be reset after users reach their limits.',
      'Users can also wait for the normal quota reset.'
    ].join(' '),
    url: 'https://event.test/openai-quota',
    discovery: { publisher: 'event.test', score: 20 }
  };
  expanded.discover = async ({ topic: query }) => bundle(query, [article]);

  try {
    const result = await scoped.discover({
      topic,
      topicPlannerClient: fakePlannerClient({
        canonicalTopic: topic,
        subjects: ['OpenAI'],
        eventTerms: ['testing usage limits', 'quota reset'],
        actionTerms: ['testing'],
        contextTerms: ['usage limits', 'quota'],
        searchQueries: [topic, 'OpenAI testing usage limits quota reset'],
        marketIntent: false,
        relation: 'event'
      })
    });
    assert.equal(result.sources.length, 1);
    assert.equal(result.scopeMode, 'soft-relevant');
    assert.match(result.sources[0].title, /OpenAI/i);
  } finally { expanded.discover = original; }
});
