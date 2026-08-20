const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const identity = require('../src/services/autoSourceTopicIdentity');
const locked = require('../src/services/autoSourceTopicLockedComposer');

const topic = 'SpaceXAI memperkenalkan Grok 4.6';

const sources = [
  {
    title: 'SpaceXAI launches Grok 4.6',
    url: 'https://one.test/grok-46',
    text: [
      'SpaceXAI launched Grok 4.6 for long-running AI agents and complex tasks.',
      'Grok 4.6 scored five points higher than Grok 4.5 on the Intelligence Index.',
      'Grok 4.6 is priced below several frontier competitors while remaining competitive on agentic benchmarks.',
      'Grok 4.6 is available through SpaceXAI developer products after its August launch.',
      'Grok 4.5 was released in July 2026 as an earlier model.'
    ].join(' '),
    discovery: { score: 100 }
  },
  {
    title: 'Google updates headphones',
    url: 'https://two.test/headphones',
    text: 'Google did not launch new headphones and instead refreshed an older product 44 minutes ago. The update adds battery improvements and audio controls.',
    discovery: { score: 99 }
  },
  {
    title: 'Grok 4.5 launch recap',
    url: 'https://three.test/grok-45',
    text: 'Grok 4.5 launched in July 2026. Grok 4.5 was trained with Cursor and focused on coding and knowledge work.',
    discovery: { score: 98 }
  },
  {
    title: 'Grok 4.6 benchmark report',
    url: 'https://four.test/grok-46-bench',
    text: 'Grok 4.6 performs near other frontier models on independent intelligence benchmarks. Grok 4.6 is especially competitive on agentic AI evaluations.',
    discovery: { score: 97 }
  }
];

test('topic identity extracts exact Grok 4.6 lock', () => {
  assert.deepEqual(identity.specificIdentities(topic).map(item => item.phrase), ['grok 4.6']);
  assert.equal(identity.identityMatches(topic, 'Grok 4.6 is now available for developers.'), true);
  assert.equal(identity.identityMatches(topic, 'Grok 4.5 launched in July 2026.'), false);
  assert.equal(identity.identityMatches(topic, 'Google updates its headphones.'), false);
});

test('relative-time metadata is rejected before it can become content', () => {
  assert.equal(identity.relativeTimeMetadata('Produk diperbarui 44 menit lalu.'), true);
  assert.equal(identity.relativeTimeMetadata('The page was updated 2 hours ago.'), true);
  assert.equal(identity.relativeTimeMetadata('Grok 4.6 launched on August 12, 2026.'), false);
});

test('topic-locked fact candidates exclude unrelated pages and standalone sibling versions', () => {
  const candidates = locked.identityCandidates(sources, topic);
  assert.ok(candidates.length >= 4);
  assert.ok(candidates.every(item => /grok\s+4\.6/i.test(item.evidence)));
  assert.ok(!candidates.some(item => /headphone|44 minutes|44 menit/i.test(item.evidence)));
  assert.ok(!candidates.some(item => /^Grok 4\.5 launched/i.test(item.evidence)));
});

test('four slide packets remain anchored to Grok 4.6', () => {
  const packets = locked.buildSlidePackets(sources, topic, 'Fakta singkat');
  assert.equal(packets.length, 4);
  packets.forEach((packet, index) => {
    assert.equal(packet.slideIndex, index);
    assert.match(packet.mainEvidence, /grok\s+4\.6/i);
    assert.ok(!/44 minutes|44 menit/i.test(packet.mainEvidence));
  });
});
