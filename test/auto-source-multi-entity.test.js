const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const multi = require('../src/services/autoSourceMultiEntityTopic');
const composer = require('../src/services/autoSourceMultiEntityComposer');

const topic = 'CoreWeave dan Super Micro';

const sources = [
  {
    title: 'CoreWeave expands AI infrastructure capacity',
    url: 'https://core.test/a',
    text: [
      'CoreWeave expanded AI infrastructure capacity for customers running large model workloads.',
      'CoreWeave signed additional data-center capacity to support growing AI demand.',
      'CoreWeave reported new customer commitments tied to cloud infrastructure services.'
    ].join(' '),
    discovery: { score: 95 }
  },
  {
    title: 'Super Micro expands AI server business',
    url: 'https://super.test/a',
    text: [
      'Super Micro reported record AI server orders tied to accelerated computing demand.',
      'Super Micro increased production capacity for liquid-cooled AI server systems.',
      'Super Micro said its server backlog remained supported by large infrastructure deployments.'
    ].join(' '),
    discovery: { score: 94 }
  },
  {
    title: 'CoreWeave and Super Micro in AI infrastructure',
    url: 'https://shared.test/a',
    text: 'CoreWeave and Super Micro are both exposed to rising demand for AI infrastructure, but they operate in different parts of the stack.',
    discovery: { score: 90 }
  },
  {
    title: 'Market movers roundup',
    url: 'https://roundup.test/a',
    text: 'Gold rose 0.78%, Bitcoin fell 0.22%, while CoreWeave and Super Micro were also mentioned among market movers.',
    discovery: { score: 99 }
  }
];

test('explicit company pair is detected as a multi-entity topic', () => {
  assert.deepEqual(multi.entities(topic), ['CoreWeave', 'Super Micro']);
  assert.equal(multi.hasMultiEntityTopic(topic), true);
  assert.deepEqual(multi.entities('Robot humanoid'), []);
});

test('market roundup side-note is rejected when the user did not ask for stocks', () => {
  const evidence = 'Gold rose 0.78%, Bitcoin fell 0.22%, while CoreWeave and Super Micro were also mentioned among market movers.';
  assert.equal(multi.isRoundupSideNote(topic, evidence), true);
  assert.equal(multi.isRoundupSideNote('Saham CoreWeave dan Super Micro', evidence), false);
});

test('balanced fact selection keeps both companies and excludes unrelated market side-notes', () => {
  const selected = composer.selectBalancedFacts(sources, topic, 4);
  assert.equal(selected.length, 4);
  assert.ok(selected.every(item => !/Gold|Bitcoin/i.test(item.evidence)));
  const coreCount = selected.filter(item => item.matchedEntities.includes('CoreWeave')).length;
  const superCount = selected.filter(item => item.matchedEntities.includes('Super Micro')).length;
  assert.ok(coreCount >= 2, `CoreWeave should have balanced coverage, got ${coreCount}`);
  assert.ok(superCount >= 2, `Super Micro should have balanced coverage, got ${superCount}`);
});

test('slide packets never label a random fourth fact as a conclusion', () => {
  const packets = composer.buildSlidePackets(sources, topic, 'Fakta singkat');
  assert.equal(packets.length, 4);
  assert.ok(packets.every(packet => packet.targetEntities.length >= 1));
  assert.ok(packets.every(packet => packet.section !== 'KESIMPULAN'));
});

test('entity coverage checker rejects a slide that drifts to an unrelated market asset', () => {
  const packets = [
    { targetEntities: ['CoreWeave'] },
    { targetEntities: ['Super Micro'] }
  ];
  const candidate = {
    slides: [
      { title: 'CoreWeave tambah kapasitas', body: 'CoreWeave memperluas kapasitas infrastruktur AI.', points: [] },
      { title: 'Emas dan Bitcoin bergerak', body: 'Emas naik sementara Bitcoin turun.', points: [] }
    ]
  };
  const errors = composer.entityCoverageErrors(candidate, packets, topic);
  assert.ok(errors.some(error => /slide:1/.test(error) && /Super Micro/.test(error)));
});
