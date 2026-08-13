const test = require('node:test');
const assert = require('node:assert/strict');
const generation = require('../src/services/generation');
const patch = require('../src/services/autoSourcePatch');

test('manual text mode is selected when no source is supplied', () => {
  assert.equal(patch.autoSourceRequested({ mode: 'manual', useSources: false, sourceUrls: [] }), true);
});

test('explicit source mode remains pass-through', async () => {
  patch.resetForTests();
  const real = generation.generateAndSave;
  const args = { mode: 'manual', useSources: true, sourceUrls: ['source'], requestedTopic: 'baseline' };
  let received;
  generation.generateAndSave = async value => { received = value; return 7; };
  try {
    const wrapped = patch.install();
    assert.equal(await wrapped(args), 7);
    assert.strictEqual(received, args);
  } finally {
    patch.resetForTests();
    generation.generateAndSave = real;
  }
});

test('text mode keeps source lookup and trend reference disabled', async () => {
  patch.resetForTests();
  const real = generation.generateAndSave;
  let received;
  generation.generateAndSave = async value => { received = value; return 9; };
  try {
    const wrapped = patch.install();
    const input = 'Ringkasan berita yang cukup panjang untuk disusun sebagai carousel. Seluruh fakta berasal dari teks yang ditempel pengguna dan tidak perlu pencarian tambahan.';
    assert.equal(await wrapped({ mode: 'manual', useSources: false, sourceUrls: [], requestedTopic: input }), 9);
    assert.equal(received.useSources, false);
    assert.deepEqual(received.sourceUrls, []);
    assert.equal(received.useTrendReference, false);
    assert.equal(typeof received.content.generateContent, 'function');
  } finally {
    patch.resetForTests();
    generation.generateAndSave = real;
  }
});
