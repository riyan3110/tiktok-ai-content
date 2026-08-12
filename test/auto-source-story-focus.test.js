const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const focus = require('../src/services/autoSourceStoryFocus');
const routing = require('../src/services/autoSourceRoutingComposer');
const research = require('../src/services/autoSourceResearchComposer');

const topic = 'Nebius melampaui perkiraan';
const plan = {
  rawTopic: topic,
  canonicalTopic: topic,
  subjects: ['Nebius'],
  eventTerms: ['melampaui perkiraan', 'beat estimates', 'revenue'],
  searchQueries: [topic],
  marketIntent: false,
  relation: 'single',
  planner: 'test'
};

const source = {
  title: 'Nebius beats quarterly revenue estimates as AI demand grows',
  url: 'https://news.test/nebius-results',
  text: [
    'Nebius revenue reached $582.3 million in the quarter, beating analyst estimates of $572.8 million.',
    'Nebius AI cloud sales grew nearly sixfold, while total company revenue reached $582.3 million.',
    'The analyst team did not include Nebius among the 10 best stocks to buy now.',
    'Nebius expects demand to remain strong as it invests in GPUs and data centers.'
  ].join(' '),
  discovery: { score: 95, publisher: 'news.test' }
};

test('non-market news drops investment-pick editorial even when it names the subject', () => {
  const focused = focus.focusSource(topic, source, plan);
  assert.doesNotMatch(focused.text, /10 best stocks|stocks to buy/i);
  assert.match(focused.text, /Nebius revenue reached/i);
  assert.match(focused.text, /AI cloud sales grew/i);
});

test('obvious contrast sentence is split into atomic facts before slide selection', () => {
  const facts = focus.atomicFacts('Nebius AI cloud sales grew nearly sixfold, while total company revenue reached $582.3 million.');
  assert.equal(facts.length, 2);
  assert.ok(facts.some(value => /sixfold/i.test(value)));
  assert.ok(facts.some(value => /582\.3/i.test(value)));
  assert.ok(facts.every(value => !(/sixfold/i.test(value) && /582\.3/i.test(value))));
});

test('requested event is ranked ahead of subject-only background', () => {
  const eventFact = 'Nebius revenue beat analyst estimates in the latest quarter.';
  const background = 'Nebius expects demand to remain strong as it invests in GPUs and data centers.';
  assert.ok(
    focus.focusScore(topic, eventFact, source, plan) > focus.focusScore(topic, background, source, plan),
    'the fact that answers the requested event should lead the story'
  );
});

test('stock-pick language is not universally banned when the user explicitly asks for market content', () => {
  const marketPlan = { ...plan, marketIntent: true };
  assert.equal(
    focus.editorialNoise('Nebius is among the 10 best stocks to buy now.', marketPlan),
    false
  );
});

test('production generic route gives research composer focused story facts and avoids fake conclusion label', async () => {
  const original = research.compose;
  let received = null;
  research.compose = async args => {
    received = args;
    return {
      topic,
      slides: [
        { section: 'PEMBUKA', title: 'A', body: 'B', points: [] },
        { section: 'FAKTA UTAMA', title: 'C', body: 'D', points: [] },
        { section: 'KONTEKS', title: 'E', body: 'F', points: [] },
        { section: 'KESIMPULAN', title: 'G', body: 'H', points: [] }
      ]
    };
  };

  try {
    const result = await routing.compose({
      options: { requestedTopic: topic, contentFormat: 'Fakta singkat' },
      sources: [source],
      discovery: { topic, topicPlan: plan, sources: [source] }
    });

    assert.ok(received);
    assert.doesNotMatch(received.sources[0].text, /10 best stocks|stocks to buy/i);
    assert.match(received.sources[0].text, /beat|revenue/i);
    assert.equal(result.slides[3].section, 'FAKTA LANJUTAN');
  } finally {
    research.compose = original;
  }
});
