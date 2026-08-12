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

test('generic discovery understands bilingual topic anchors', async () => {
  const original = expanded.discover;
  expanded.discover = async () => bundle('Potensi manfaat AI terhadap iklim', [
    {
      title: 'AI for climate forecasting',
      text: 'Artificial intelligence is used in climate forecasting and climate research.',
      url: 'https://climate.test/ai',
      discovery: { publisher: 'climate.test' }
    }
  ]);
  try {
    const result = await scoped.discover({ topic: 'Potensi manfaat AI terhadap iklim' });
    assert.equal(result.sources.length, 1);
  } finally { expanded.discover = original; }
});
