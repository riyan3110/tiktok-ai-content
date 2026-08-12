const test = require('node:test');
const assert = require('node:assert/strict');

const expanded = require('../src/services/autoSourceExpandedDiscovery');
const scoped = require('../src/services/autoSourceScopedDiscovery');

const relevant = {
  title: 'SpaceXAI launches Grok 4.6',
  text: 'SpaceXAI launched Grok 4.6 for long-running AI agents and complex tasks.',
  discovery: { publisher: 'relevant.test' }
};
const sibling = {
  title: 'Grok 4.5 launch recap',
  text: 'Grok 4.5 launched in July and focuses on coding and knowledge work.',
  discovery: { publisher: 'sibling.test' }
};
const unrelated = {
  title: 'Google updates headphones',
  text: 'Google refreshed an older headphone product with new controls and battery improvements.',
  discovery: { publisher: 'unrelated.test' }
};

test('versioned topic keeps only fetched articles that contain the exact model/version identity', async () => {
  const original = expanded.discover;
  expanded.discover = async () => ({
    topic: 'SpaceXAI memperkenalkan Grok 4.6',
    searchedAt: '2026-08-13T00:00:00.000Z',
    providers: ['test'],
    publishers: ['relevant.test', 'sibling.test', 'unrelated.test'],
    sources: [relevant, sibling, unrelated]
  });
  try {
    const result = await scoped.discover({ topic: 'SpaceXAI memperkenalkan Grok 4.6' });
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].title, relevant.title);
    assert.deepEqual(result.publishers, ['relevant.test']);
  } finally {
    expanded.discover = original;
  }
});

test('generic topic does not activate exact version lock', async () => {
  const original = expanded.discover;
  expanded.discover = async () => ({
    topic: 'Robot humanoid',
    sources: [relevant, unrelated]
  });
  try {
    const result = await scoped.discover({ topic: 'Robot humanoid' });
    assert.equal(result.sources.length, 2);
  } finally {
    expanded.discover = original;
  }
});
