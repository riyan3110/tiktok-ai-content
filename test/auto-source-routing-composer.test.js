const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const simple = require('../src/services/autoSourceSimpleComposer');
const routing = require('../src/services/autoSourceRoutingComposer');

function source(title, text) {
  return {
    title,
    text,
    url: `https://example.test/${encodeURIComponent(title)}`,
    discovery: { score: 10, publisher: 'Example' }
  };
}

async function withSimpleStub(run) {
  const original = simple.compose;
  const calls = [];
  simple.compose = async args => {
    calls.push(args);
    return { slides: [{ section: 'PEMBUKA' }, {}, {}, { section: 'KESIMPULAN' }] };
  };
  try { return await run(calls); }
  finally { simple.compose = original; }
}

test('all free-form topic shapes use the same simple composer', async () => {
  const cases = [
    {
      topic: 'CoreWeave dan Super Micro',
      source: source(
        'CoreWeave dan Super Micro memperluas infrastruktur AI',
        'CoreWeave memperluas kapasitas cloud AI. Super Micro memasok server AI. Kedua perusahaan meningkatkan infrastruktur komputasi. Permintaan server AI tetap kuat. Ekspansi kapasitas berlanjut tahun ini.'
      )
    },
    {
      topic: 'SpaceXAI memperkenalkan Grok 4.6',
      source: source(
        'SpaceXAI memperkenalkan Grok 4.6',
        'SpaceXAI memperkenalkan Grok 4.6. Model baru itu ditujukan untuk tugas kompleks. Grok 4.6 tersedia melalui layanan perusahaan. Model tersebut membawa pembaruan kemampuan agen. Peluncuran dilakukan bertahap.'
      )
    },
    {
      topic: 'Robot humanoid',
      source: source(
        'Robot humanoid berkembang untuk industri',
        'Robot humanoid semakin digunakan di industri. Mesin ini dapat menangani tugas berulang. Sejumlah perusahaan menguji robot di pabrik. Sistem sensor membantu navigasi. Pengembangan perangkat keras terus berlanjut.'
      )
    }
  ];

  await withSimpleStub(async calls => {
    for (const entry of cases) {
      await routing.compose({
        options: { requestedTopic: entry.topic, contentFormat: 'Fakta singkat' },
        sources: [entry.source],
        discovery: { topic: entry.topic, sources: [entry.source] }
      });
    }
    assert.equal(calls.length, cases.length);
    assert.ok(calls.every(call => Array.isArray(call.sources) && call.sources.length > 0));
  });
});

test('event neighborhood keeps usable story facts instead of returning an empty generation', () => {
  const topic = 'OpenAI sedang menguji fitur batasan penggunaan';
  const plan = {
    rawTopic: topic,
    canonicalTopic: topic,
    subjects: ['OpenAI'],
    eventTerms: ['testing usage limits'],
    actionTerms: ['testing'],
    contextTerms: ['usage limits', 'quota'],
    marketIntent: false,
    relation: 'event',
    planner: 'ai'
  };
  const input = source(
    'OpenAI is testing a pay-to-reset quota feature',
    [
      'OpenAI is testing an option for users who hit usage limits.',
      'Some Plus users saw an option to pay for an immediate quota reset.',
      'The reset restores depleted weekly usage.',
      'Users can still wait for the normal quota reset instead.',
      'OpenAI separately announced protections for users under 18.',
      'OpenAI also discussed a Pentagon agreement in another policy update.'
    ].join(' ')
  );

  const narrowed = routing.eventNeighborhoodSource(topic, input, plan);
  assert.match(narrowed.text, /usage limits|quota reset/i);
  assert.ok(routing.factCount(narrowed, plan) >= 4);
  assert.doesNotMatch(narrowed.text, /Pentagon/i);
});
