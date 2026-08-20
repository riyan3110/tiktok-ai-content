const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const routing = require('../src/services/autoSourceRoutingComposer');
const simple = require('../src/services/autoSourceSimpleComposer');

function input(topic, text, title = topic, topicPlan = null) {
  return {
    options: { requestedTopic: topic, contentFormat: 'Fakta singkat' },
    sources: [{ title, text, url: 'https://example.test/article' }],
    discovery: { topic, sources: [], ...(topicPlan ? { topicPlan } : {}) }
  };
}

async function captureSimple(run) {
  const original = simple.compose;
  let received;
  simple.compose = async args => {
    received = args;
    return { slides: [{ section: 'PEMBUKA' }, {}, {}, { section: 'KESIMPULAN' }] };
  };
  try {
    await run();
    return received;
  } finally { simple.compose = original; }
}

test('generic simple composer receives only topic-relevant article facts', async () => {
  const received = await captureSimple(() => routing.compose(input(
    'Aplikasi Gemini',
    'Gemini adds a new feature for users. Gold rose 1% and Bitcoin fell. Gemini connects with selected Google services.',
    'Gemini app update'
  )));
  assert.match(received.sources[0].text, /Gemini adds/i);
  assert.match(received.sources[0].text, /Gemini connects/i);
  assert.doesNotMatch(received.sources[0].text, /Gold rose|Bitcoin fell/i);
});

test('versioned topic stays on the requested model identity before the simple writer', async () => {
  const topic = 'SpaceXAI memperkenalkan Grok 4.6';
  const received = await captureSimple(() => routing.compose(input(
    topic,
    'SpaceXAI introduced Grok 4.6 for long-running agent tasks. Grok 4.6 improves tool use. Grok 4.5 launched in July. Google refreshed headphones.',
    'SpaceXAI introduces Grok 4.6',
    {
      rawTopic: topic,
      canonicalTopic: topic,
      subjects: ['SpaceXAI', 'Grok 4.6'],
      eventTerms: ['introduces Grok 4.6'],
      actionTerms: ['memperkenalkan', 'introduces'],
      contextTerms: [],
      marketIntent: false,
      relation: 'event',
      planner: 'ai'
    }
  )));
  assert.match(received.sources[0].text, /Grok 4\.6/i);
  assert.doesNotMatch(received.sources[0].text, /Grok 4\.5|headphones/i);
});

test('multi-entity topic keeps requested entities and removes market side-notes', async () => {
  const received = await captureSimple(() => routing.compose(input(
    'CoreWeave dan Super Micro',
    'CoreWeave expands AI cloud capacity. Gold rose while Bitcoin fell. Super Micro reports record AI-server orders.',
    'CoreWeave and Super Micro AI infrastructure'
  )));
  assert.match(received.sources[0].text, /CoreWeave expands/i);
  assert.match(received.sources[0].text, /Super Micro reports/i);
  assert.doesNotMatch(received.sources[0].text, /Gold rose|Bitcoin fell/i);
});
