const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const versioned = require('../src/services/autoSourceTopicLockedComposer');
const multiEntity = require('../src/services/autoSourceMultiEntityComposer');
const research = require('../src/services/autoSourceResearchComposer');
const routing = require('../src/services/autoSourceRoutingComposer');

async function withStubs(run) {
  const originals = {
    versioned: versioned.compose,
    multiEntity: multiEntity.compose,
    research: research.compose
  };
  const calls = [];
  versioned.compose = async () => { calls.push('versioned'); return 'versioned'; };
  multiEntity.compose = async () => { calls.push('multi'); return 'multi'; };
  research.compose = async () => { calls.push('research'); return 'research'; };
  try { return await run(calls); }
  finally {
    versioned.compose = originals.versioned;
    multiEntity.compose = originals.multiEntity;
    research.compose = originals.research;
  }
}

test('company pair routes to multi-entity composer', async () => {
  await withStubs(async calls => {
    const result = await routing.compose({ options: { requestedTopic: 'CoreWeave dan Super Micro' } });
    assert.equal(result, 'multi');
    assert.deepEqual(calls, ['multi']);
  });
});

test('specific model version keeps exact version composer', async () => {
  await withStubs(async calls => {
    const result = await routing.compose({ options: { requestedTopic: 'SpaceXAI memperkenalkan Grok 4.6' } });
    assert.equal(result, 'versioned');
    assert.deepEqual(calls, ['versioned']);
  });
});

test('generic topic stays on research composer', async () => {
  await withStubs(async calls => {
    const result = await routing.compose({ options: { requestedTopic: 'Robot humanoid' } });
    assert.equal(result, 'research');
    assert.deepEqual(calls, ['research']);
  });
});
