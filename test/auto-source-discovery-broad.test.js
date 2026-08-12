const test = require('node:test');
const assert = require('node:assert/strict');
const discovery = require('../src/services/autoSourceDiscovery');

function fakeResponse({ ok = true, text = '', json = null } = {}) {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => text,
    json: async () => json
  };
}

test('broad topic uses expanded queries and relaxed two-anchor relevance without accepting unrelated sources', async () => {
  discovery.clearCache();
  const calls = [];
  const searchImpl = async query => {
    calls.push(query);
    return [
      { title: 'Humanoid robots move into industrial work', url: 'https://robotics.example/humanoid-industrial', description: 'New humanoid machines and robot systems for physical work', provider: 'test' },
      { title: 'Unrelated smartphone launch', url: 'https://phones.example/new-device', description: 'A mobile phone announcement', provider: 'test' }
    ];
  };
  const sourceFetcher = {
    validateUrl: async raw => new URL(raw),
    fetchSources: async urls => urls[0].includes('robotics.example') ? [{
      url: urls[0], finalUrl: urls[0], title: 'Humanoid robots move into industrial work',
      text: 'Humanoid robots use articulated bodies, sensors, actuators, balance control, and software to perform physical tasks. Robot developers are testing humanoid machines for factories, logistics, and other environments where human-shaped movement can be useful. Some systems combine cameras and force sensors with software that coordinates walking, grasping, and balance.',
      fetchedAt: '2026-08-12T00:00:00.000Z'
    }] : [{
      url: urls[0], finalUrl: urls[0], title: 'Smartphone launch',
      text: 'This article is only about a smartphone, camera, display, battery, and mobile processor specifications.',
      fetchedAt: '2026-08-12T00:00:00.000Z'
    }]
  };

  const result = await discovery.discover({ topic: 'Robot humanoid', category: 'Edukasi teknologi', searchImpl, sourceFetcher, now: () => Date.parse('2026-08-12T00:00:00.000Z') });
  assert.ok(calls.length >= 3 && calls.length <= 4);
  assert.equal(discovery.minimumRelevantFraction('Robot humanoid'), 0.5);
  assert.ok(result.sources.length >= 1);
  assert.ok(result.sources.every(source => /robot|humanoid/i.test(`${source.title} ${source.text}`)));
  assert.ok(!result.sources.some(source => /phones\.example/.test(source.finalUrl)));
});

test('Bing Web RSS and Wikipedia are supported as additional discovery providers', async () => {
  const rss = '<?xml version="1.0"?><rss><channel><item><title>Atlas humanoid robot overview</title><link>https://example.org/atlas-robot</link><description>Humanoid robot research overview</description><pubDate>Tue, 12 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>';
  const bing = await discovery.searchBingWeb('humanoid robot', { fetchImpl: async () => fakeResponse({ text: rss }) });
  assert.equal(bing[0].provider, 'bing-web');
  assert.equal(bing[0].url, 'https://example.org/atlas-robot');

  const wiki = await discovery.searchWikipedia('robot humanoid', {
    language: 'id',
    fetchImpl: async () => fakeResponse({ json: ['robot humanoid', ['Robot humanoid'], ['Robot dengan bentuk tubuh menyerupai manusia'], ['https://id.wikipedia.org/wiki/Robot_humanoid']] })
  });
  assert.equal(wiki[0].provider, 'wikipedia-id');
  assert.match(wiki[0].url, /wikipedia\.org\/wiki\/Robot_humanoid/);
});
