const test = require('node:test');
const assert = require('node:assert/strict');
const discovery = require('../src/services/autoSourceDiscovery');

function source(url, title, text) {
  return { url, finalUrl: url, title, text, fetchedAt: '2026-08-12T00:00:00.000Z' };
}

test('auto source discovery ranks relevant readable sources and removes duplicate URLs', async () => {
  discovery.clearCache();
  const searchCalls = [];
  const searchImpl = async query => {
    searchCalls.push(query);
    return [
      { title: 'Northstar Browser gets workspace controls', url: 'https://northstar.example/news/workspaces?utm_source=test', description: 'Northstar Browser workspace controls and privacy update', provider: 'test' },
      { title: 'Northstar Browser gets workspace controls', url: 'https://northstar.example/news/workspaces', description: 'duplicate', provider: 'test' },
      { title: 'Northstar Browser release notes', url: 'https://docs.northstar.example/releases/august', description: 'Official Northstar Browser release details', provider: 'test' },
      { title: 'Unrelated cooking story', url: 'https://food.example/story', description: 'Recipes and kitchen ideas', provider: 'test' }
    ];
  };
  const fetched = new Map([
    ['https://northstar.example/news/workspaces', source('https://northstar.example/news/workspaces', 'Northstar Browser workspace controls', 'Northstar Browser adds workspace controls for shared computers. The update also adds local privacy settings and synchronization controls for supported devices. This article contains enough detailed source material for a grounded carousel about Northstar Browser.')],
    ['https://docs.northstar.example/releases/august', source('https://docs.northstar.example/releases/august', 'Northstar Browser release notes', 'Northstar Browser release notes describe new workspace controls, local profile settings, and administrator options. The release is available to supported desktop devices and includes migration guidance for managed deployments.')],
    ['https://food.example/story', source('https://food.example/story', 'Cooking story', 'This long article discusses recipes, ingredients, cooking equipment, kitchen preparation, and meal planning. It does not discuss browsers, software, workspaces, privacy controls, or the requested technology topic at all.')]
  ]);
  const sourceFetcher = {
    fetchSources: async urls => [fetched.get(urls[0])].filter(Boolean),
    validateUrl: async raw => new URL(raw)
  };

  const result = await discovery.discover({
    topic: 'Northstar Browser',
    category: 'Edukasi teknologi',
    searchImpl,
    sourceFetcher,
    now: () => Date.parse('2026-08-12T00:00:00.000Z')
  });

  assert.ok(searchCalls.length >= 1 && searchCalls.length <= 2);
  assert.equal(result.topic, 'Northstar Browser');
  assert.ok(result.sources.length >= 1 && result.sources.length <= 2);
  assert.equal(new Set(result.sources.map(item => item.finalUrl)).size, result.sources.length);
  assert.ok(result.sources.every(item => /northstar/i.test(`${item.title} ${item.text}`)));
  assert.ok(!result.sources.some(item => item.finalUrl === 'https://food.example/story'));
});

test('manual search queries stay bounded and include the exact topic', () => {
  const queries = discovery.searchQueries('Lentera OS', 'Edukasi teknologi');
  assert.deepEqual(queries, ['Lentera OS', 'Lentera OS Edukasi teknologi']);
  assert.ok(queries.length <= 2);
});

test('low-value search and social URLs are rejected before fetch', () => {
  assert.equal(discovery.candidateAllowed('https://example.com/search?q=northstar'), false);
  assert.equal(discovery.candidateAllowed('https://www.facebook.com/post/123'), false);
  assert.equal(discovery.candidateAllowed('https://www.bing.com/news/search?q=northstar'), false);
  assert.equal(discovery.candidateAllowed('https://example.com/news/northstar-browser-update'), true);
});

test('Bing News redirect is unwrapped to the publisher article URL', () => {
  const target = 'https://www.cnet.com/tech/services-and-software/anthropic-watermark-story/';
  const redirect = `https://www.bing.com/news/apiclick.aspx?ref=example&url=${encodeURIComponent(target)}&c=1`;
  assert.equal(discovery.unwrapKnownRedirect(redirect), target);
  assert.equal(discovery.canonicalUrl(redirect), target.replace(/\/$/, ''));
  assert.equal(discovery.candidateAllowed(redirect), true);
});

test('Indonesian helper verbs do not dilute topic relevance anchors', () => {
  const score = discovery.relevanceScore(
    'Anthropic akan memberi watermark',
    'Anthropic introduces invisible watermarking for Claude-generated text and files.'
  );
  assert.equal(score, 1);
});
