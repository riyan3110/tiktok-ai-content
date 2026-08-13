const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const planner = require('../src/services/autoSourceDynamicTopicPlan');
const expanded = require('../src/services/autoSourceExpandedDiscovery');
const scoped = require('../src/services/autoSourceScopedDiscovery');

const TOPIC = 'Kenali waktu ChatGPT riset pemikiran';
const CANONICAL = 'Waktu berpikir ChatGPT untuk riset dan tugas kompleks';
const SEARCH_QUERY = 'ChatGPT thinking time research complex tasks';

function intentClient(events = []) {
  return {
    chat: {
      completions: {
        create: async ({ messages }) => {
          const prompt = String(messages?.at(-1)?.content || '');
          if (prompt.includes('SELEKSI SUMBER AUTO SOURCE')) {
            events.push('select');
            return { choices: [{ message: { content: JSON.stringify({ acceptedSourceIds: ['source-1'] }) } }] };
          }
          events.push('plan');
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  canonicalTopic: CANONICAL,
                  subjects: ['ChatGPT'],
                  eventTerms: ['thinking time', 'research', 'reasoning'],
                  actionTerms: [],
                  contextTerms: ['thinking time', 'research', 'complex tasks'],
                  searchQueries: [TOPIC, SEARCH_QUERY],
                  marketIntent: false,
                  relation: 'general'
                })
              }
            }]
          };
        }
      }
    }
  };
}

test('editorial opener is not misread as the subject of a free-form topic', () => {
  const plan = planner.fallbackPlan(TOPIC);
  assert.deepEqual(plan.subjects, ['ChatGPT']);
  assert.equal(plan.eventTerms.some(term => /^kenali$/i.test(term)), false);
  assert.equal(expanded.anchorGroups(TOPIC).flat().some(term => /^kenali$/i.test(term)), false);
});

test('manual topic is understood before search and a keyword-neighbor article is rejected after reading', async () => {
  const original = expanded.discover;
  const events = [];
  const correct = {
    title: 'ChatGPT adds a thinking-time control for research and complex work',
    text: 'ChatGPT users can choose how much thinking time a response receives. Higher effort is intended for research, planning, writing, coding, and complex decisions.',
    url: 'https://right.test/chatgpt-thinking-time',
    finalUrl: 'https://right.test/chatgpt-thinking-time',
    publishedAt: '2026-08-06T00:00:00.000Z',
    discovery: { publisher: 'right.test', score: 99 }
  };
  const wrong = {
    title: 'Perbedaan ChatGPT Pro, Plus, dan Go? Kenali Fitur dan Harganya',
    text: 'Paket ChatGPT memiliki harga dan target pengguna berbeda. Paket Plus menawarkan deep research dan advanced reasoning sebagai bagian dari daftar fiturnya.',
    url: 'https://wrong.test/chatgpt-pricing',
    finalUrl: 'https://wrong.test/chatgpt-pricing',
    publishedAt: '2026-08-13T00:00:00.000Z',
    discovery: { publisher: 'wrong.test', score: 100 }
  };

  expanded.discover = async ({ topic }) => {
    events.push(`search:${topic}`);
    return {
      topic,
      searchedAt: '2026-08-13T00:00:00.000Z',
      queries: [topic],
      providers: ['test'],
      publishers: ['right.test', 'wrong.test'],
      sources: [correct, wrong]
    };
  };

  try {
    const client = intentClient(events);
    const result = await scoped.discover({
      topic: TOPIC,
      topicPlannerClient: client,
      sourceSelectorClient: client
    });

    assert.deepEqual(events, ['plan', `search:${SEARCH_QUERY}`, 'select']);
    assert.equal(result.topic, TOPIC);
    assert.equal(result.topicPlan.canonicalTopic, CANONICAL);
    assert.equal(result.sourceSelection.mode, 'ai');
    assert.deepEqual(result.sources.map(source => source.finalUrl), [correct.finalUrl]);
    assert.doesNotMatch(result.sources[0].title, /Pro, Plus, dan Go/i);
  } finally {
    expanded.discover = original;
  }
});

test('selector failure stays fail-soft so a new topic is not rejected by a closed list', async () => {
  const source = {
    title: 'NovaForge announces FluxCore',
    text: 'NovaForge announced FluxCore for new energy research workloads.',
    url: 'https://novel.test/fluxcore'
  };
  const client = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: JSON.stringify({ unexpected: true }) } }] })
      }
    }
  };
  const selected = await planner.selectSources('NovaForge FluxCore', planner.fallbackPlan('NovaForge FluxCore'), [source], { client });
  assert.equal(selected.mode, 'fallback');
  assert.deepEqual(selected.sources, [source]);
});
