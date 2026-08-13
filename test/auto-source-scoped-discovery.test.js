const test = require('node:test');
const assert = require('node:assert/strict');

const expanded = require('../src/services/autoSourceExpandedDiscovery');
const scoped = require('../src/services/autoSourceScopedDiscovery');

const relevant = {
  title: 'SpaceXAI memperkenalkan Grok 4.6',
  text: 'SpaceXAI memperkenalkan Grok 4.6 untuk agen AI yang berjalan lama dan tugas kompleks.',
  url: 'https://relevant.test/grok-4-6',
  finalUrl: 'https://relevant.test/grok-4-6',
  discovery: { publisher: 'relevant.test' }
};
const sibling = {
  title: 'Grok 4.5 launch recap',
  text: 'Grok 4.5 launched in July and focuses on coding and knowledge work.',
  url: 'https://sibling.test/grok-4-5',
  finalUrl: 'https://sibling.test/grok-4-5',
  discovery: { publisher: 'sibling.test' }
};
const unrelated = {
  title: 'Google updates headphones',
  text: 'Google refreshed an older headphone product with new controls and battery improvements.',
  url: 'https://unrelated.test/headphones',
  finalUrl: 'https://unrelated.test/headphones',
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

test('generic topic does not activate exact version or multi-entity lock', async () => {
  const original = expanded.discover;
  const industrial = {
    title: 'Robot humanoid mulai digunakan di pabrik',
    text: 'Robot humanoid menangani tugas material berulang di lingkungan industri.',
    url: 'https://robot.test/industrial',
    finalUrl: 'https://robot.test/industrial',
    discovery: { publisher: 'robot.test' }
  };
  const research = {
    title: 'Riset robot humanoid mengembangkan sistem keseimbangan',
    text: 'Robot humanoid memakai sensor dan kontrol gerak untuk menjaga keseimbangan.',
    url: 'https://research.test/humanoid',
    finalUrl: 'https://research.test/humanoid',
    discovery: { publisher: 'research.test' }
  };
  expanded.discover = async () => ({
    topic: 'Robot humanoid',
    sources: [industrial, research]
  });
  try {
    const result = await scoped.discover({ topic: 'Robot humanoid' });
    assert.equal(result.sources.length, 2);
  } finally {
    expanded.discover = original;
  }
});

test('multi-entity discovery rejects a market roundup that only mentions both companies once', async () => {
  const original = expanded.discover;
  const core = {
    title: 'CoreWeave expands AI cloud capacity',
    finalUrl: 'https://core.test/a',
    text: 'CoreWeave expanded AI cloud capacity. CoreWeave added infrastructure for new customer workloads.',
    discovery: { publisher: 'core.test' }
  };
  const superMicro = {
    title: 'Super Micro expands AI server production',
    finalUrl: 'https://super.test/a',
    text: 'Super Micro expanded AI server production. Super Micro reported additional infrastructure orders.',
    discovery: { publisher: 'super.test' }
  };
  const roundup = {
    title: 'Markets today: gold, bitcoin and movers',
    finalUrl: 'https://market.test/a',
    text: 'Gold rose 0.78% and Bitcoin fell 0.22%. CoreWeave and Super Micro were mentioned among other market movers.',
    discovery: { publisher: 'market.test' }
  };
  expanded.discover = async () => ({
    topic: 'CoreWeave dan Super Micro',
    queries: ['combined'],
    providers: ['test'],
    sources: [roundup, core, superMicro]
  });
  try {
    const result = await scoped.discover({ topic: 'CoreWeave dan Super Micro' });
    assert.deepEqual(result.sources.map(source => source.finalUrl).sort(), [core.finalUrl, superMicro.finalUrl].sort());
  } finally {
    expanded.discover = original;
  }
});

test('multi-entity discovery runs targeted fallback when one requested company is missing', async () => {
  const original = expanded.discover;
  const core = {
    title: 'CoreWeave expands AI cloud capacity',
    finalUrl: 'https://core.test/a',
    text: 'CoreWeave expanded AI cloud capacity. CoreWeave added infrastructure for new customer workloads.',
    discovery: { publisher: 'core.test' }
  };
  const superMicro = {
    title: 'Super Micro expands AI server production',
    finalUrl: 'https://super.test/a',
    text: 'Super Micro expanded AI server production. Super Micro reported additional infrastructure orders.',
    discovery: { publisher: 'super.test' }
  };
  expanded.discover = async ({ topic }) => {
    if (topic === 'Super Micro') {
      return { topic, queries: ['super targeted'], providers: ['targeted'], sources: [superMicro] };
    }
    return { topic, queries: ['combined'], providers: ['test'], sources: [core] };
  };
  try {
    const result = await scoped.discover({ topic: 'CoreWeave dan Super Micro' });
    assert.equal(result.sources.length, 2);
    assert.ok(result.sources.some(source => source.title.includes('CoreWeave')));
    assert.ok(result.sources.some(source => source.title.includes('Super Micro')));
    assert.ok(result.queries.includes('super targeted'));
  } finally {
    expanded.discover = original;
  }
});
