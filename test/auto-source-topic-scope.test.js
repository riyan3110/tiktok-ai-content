const test = require('node:test');
const assert = require('node:assert/strict');

const scope = require('../src/services/autoSourceTopicScope');

function source(title, text) {
  return { title, text, url: `https://example.test/${encodeURIComponent(title)}` };
}

test('single-product topic keeps Gemini facts and drops unrelated article side notes', () => {
  const topic = 'Aplikasi Gemini';
  const input = source(
    'Gemini app update',
    'Gemini adds a new conversational feature for users. Gold rose 1.2% while Bitcoin fell 0.4%. Gemini can connect with selected Google services.'
  );
  const scoped = scope.scopeSource(topic, input);
  assert.match(scoped.text, /Gemini adds/i);
  assert.match(scoped.text, /Gemini can connect/i);
  assert.doesNotMatch(scoped.text, /Gold rose|Bitcoin fell/i);
});

test('feature topic requires Ask Maps context rather than generic Google facts', () => {
  const topic = 'Google hadirkan fitur Ask Maps';
  const input = source(
    'Google expands Ask Maps',
    'Ask Maps can answer conversational questions about places. Google also refreshed an older headphone product. Ask Maps can use real-time transit information.'
  );
  const scoped = scope.scopeSource(topic, input);
  assert.match(scoped.text, /Ask Maps can answer/i);
  assert.match(scoped.text, /Ask Maps can use real-time transit/i);
  assert.doesNotMatch(scoped.text, /headphone/i);
});

test('generic lowercase topic can stay scoped without named-company heuristics', () => {
  const topic = 'robot humanoid';
  const input = source(
    'Humanoid robots enter factories',
    'A humanoid robot can perform repeated material-handling tasks. Smartphone shipments also increased this quarter. Humanoid robots are being tested in factories.'
  );
  const scoped = scope.scopeSource(topic, input);
  assert.match(scoped.text, /humanoid robot/i);
  assert.doesNotMatch(scoped.text, /Smartphone shipments/i);
});

test('bilingual broad topic matches English climate evidence', () => {
  const topic = 'Potensi manfaat AI terhadap iklim';
  const input = source(
    'AI for climate forecasting',
    'Artificial intelligence is used in climate forecasting research. A separate article section discusses football results.'
  );
  assert.equal(scope.sourceInScope(topic, input), true);
  const scoped = scope.scopeSource(topic, input);
  assert.match(scoped.text, /climate forecasting/i);
  assert.doesNotMatch(scoped.text, /football/i);
});

test('named topic with context keeps entity and context together', () => {
  const topic = 'Bluesky hadapi penurunan pengguna aktif';
  const input = source(
    'Bluesky active users decline',
    'Bluesky active users declined during the measured period. Another section covers unrelated app-store rankings.'
  );
  const scoped = scope.scopeSource(topic, input);
  assert.match(scoped.text, /Bluesky active users declined/i);
  assert.doesNotMatch(scoped.text, /app-store rankings/i);
});

test('market roundup side note is rejected when user did not request market data', () => {
  const topic = 'CoreWeave';
  const evidence = 'Gold rose 0.78%; Bitcoin fell 0.22%; CoreWeave shares were also mentioned later in trading.';
  assert.equal(scope.genericRoundupSideNote(topic, evidence), true);
  assert.equal(scope.evidenceInScope(topic, evidence, source('CoreWeave update', evidence)), false);
});

test('market facts remain allowed when market intent is explicit', () => {
  const topic = 'saham CoreWeave';
  const input = source('CoreWeave stock rises', 'CoreWeave shares rose 12% after the company update.');
  assert.equal(scope.marketIntent(topic), true);
  assert.equal(scope.sourceInScope(topic, input), true);
});

test('versioned and multi-entity topics keep their specialized hard scope', () => {
  assert.equal(
    scope.evidenceInScope('SpaceXAI memperkenalkan Grok 4.6', 'Grok 4.5 launched in July.', source('Grok history', 'Grok 4.5 launched in July.')),
    false
  );
  assert.equal(
    scope.evidenceInScope('SpaceXAI memperkenalkan Grok 4.6', 'Grok 4.6 is designed for long-running agent tasks.', source('Grok 4.6', 'Grok 4.6 is designed for long-running agent tasks.')),
    true
  );
  assert.equal(
    scope.evidenceInScope('CoreWeave dan Super Micro', 'Gold rose while Bitcoin fell before CoreWeave was mentioned.', source('Markets', 'Gold rose while Bitcoin fell before CoreWeave was mentioned.')),
    false
  );
});
