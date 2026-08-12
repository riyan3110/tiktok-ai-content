const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const routing = require('../src/services/autoSourceRoutingComposer');
const research = require('../src/services/autoSourceResearchComposer');
const versioned = require('../src/services/autoSourceTopicLockedComposer');
const multiEntity = require('../src/services/autoSourceMultiEntityComposer');

function input(topic, text, title = topic) {
  return {
    options: { requestedTopic: topic, contentFormat: 'Fakta singkat' },
    sources: [{ title, text, url: 'https://example.test/article' }],
    discovery: { topic, sources: [] }
  };
}

test('generic research composer receives only topic-scoped article sentences', async () => {
  const original = research.compose;
  let received;
  research.compose = async args => { received = args; return { ok: true }; };
  try {
    await routing.compose(input(
      'Aplikasi Gemini',
      'Gemini adds a new feature for users. Gold rose 1% and Bitcoin fell. Gemini connects with selected Google services.',
      'Gemini app update'
    ));
    assert.match(received.sources[0].text, /Gemini adds/i);
    assert.match(received.sources[0].text, /Gemini connects/i);
    assert.doesNotMatch(received.sources[0].text, /Gold rose|Bitcoin fell/i);
  } finally { research.compose = original; }
});

test('versioned composer receives only exact-version sentences', async () => {
  const original = versioned.compose;
  let received;
  versioned.compose = async args => { received = args; return { ok: true }; };
  try {
    await routing.compose(input(
      'SpaceXAI memperkenalkan Grok 4.6',
      'Grok 4.6 targets long-running agent tasks. Grok 4.5 launched in July. Google refreshed headphones.',
      'Grok 4.6 launch'
    ));
    assert.match(received.sources[0].text, /Grok 4\.6/i);
    assert.doesNotMatch(received.sources[0].text, /Grok 4\.5|headphones/i);
  } finally { versioned.compose = original; }
});

test('multi-entity composer receives only sentences about requested entities', async () => {
  const original = multiEntity.compose;
  let received;
  multiEntity.compose = async args => { received = args; return { ok: true }; };
  try {
    await routing.compose(input(
      'CoreWeave dan Super Micro',
      'CoreWeave expands AI cloud capacity. Gold rose while Bitcoin fell. Super Micro reports record AI-server orders.',
      'CoreWeave and Super Micro AI infrastructure'
    ));
    assert.match(received.sources[0].text, /CoreWeave expands/i);
    assert.match(received.sources[0].text, /Super Micro reports/i);
    assert.doesNotMatch(received.sources[0].text, /Gold rose|Bitcoin fell/i);
  } finally { multiEntity.compose = original; }
});
