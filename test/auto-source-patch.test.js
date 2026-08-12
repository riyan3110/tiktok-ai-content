const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const generation = require('../src/services/generation');
const autoSourcePatch = require('../src/services/autoSourcePatch');
const { autoSourceRequested, pakaiUrlRequested } = autoSourcePatch;

const AUTO_SOURCE_MODULES = [
  '../src/services/autoSourceFastDiscovery',
  '../src/services/autoSourceExpandedDiscovery',
  '../src/services/autoSourceQualityLayer',
  '../src/services/autoSourceRuntimeGuard',
  '../src/services/autoSourcePlanFinalizer',
  '../src/services/autoSourceStrictFinalizer',
  '../src/services/autoSourceComposer',
  '../src/services/autoSourceSimpleComposer'
];

function clearAutoSourceCaches() {
  for (const modulePath of AUTO_SOURCE_MODULES) {
    try { delete require.cache[require.resolve(modulePath)]; } catch {}
  }
}

test('manual Tanpa URL activates auto source even when legacy UI sends useSources=false', () => {
  assert.equal(autoSourceRequested({ mode: 'manual', useSources: false, sourceUrls: [] }), true);
});

test('manual Pakai URL stays on the existing URL path', () => {
  const args = { mode: 'manual', useSources: true, sourceUrls: ['https://example.test/article'] };
  assert.equal(pakaiUrlRequested(args), true);
  assert.equal(autoSourceRequested(args), false);
});

test('manual Pakai URL with an empty field is still handled by the existing URL validation path', () => {
  const args = { mode: 'manual', useSources: true, sourceUrls: [] };
  assert.equal(pakaiUrlRequested(args), true);
  assert.equal(autoSourceRequested(args), false);
});

test('supplied URL never enters Auto Source even if a caller forgets useSources=true', () => {
  const args = { mode: 'manual', useSources: false, sourceUrls: ['https://example.test/article'] };
  assert.equal(pakaiUrlRequested(args), true);
  assert.equal(autoSourceRequested(args), false);
});

test('automatic AI topic mode without URLs is not hijacked by manual auto source', () => {
  assert.equal(autoSourceRequested({ mode: 'ai', useSources: false, sourceUrls: [] }), false);
});

test('simple Auto Source loader does not install legacy strict/plan validator stack', () => {
  clearAutoSourceCaches();
  const dependencies = autoSourcePatch.loadAutoSourceDependencies();
  assert.ok(dependencies.autoSourceDiscovery);
  assert.ok(dependencies.autoSourceSimpleComposer);
  assert.equal('autoSourceComposer' in dependencies, false);
  assert.equal('autoSourcePlanFinalizer' in dependencies, false);
  assert.equal(require.cache[require.resolve('../src/services/autoSourceQualityLayer')], undefined);
  assert.equal(require.cache[require.resolve('../src/services/autoSourceRuntimeGuard')], undefined);
  assert.equal(require.cache[require.resolve('../src/services/autoSourcePlanFinalizer')], undefined);
  assert.equal(require.cache[require.resolve('../src/services/autoSourceStrictFinalizer')], undefined);
});

test('Pakai URL is exact pass-through to the pre-Auto-Source generator', async () => {
  autoSourcePatch.resetForTests();
  clearAutoSourceCaches();
  const realGenerateAndSave = generation.generateAndSave;
  const args = {
    mode: 'manual',
    useSources: true,
    sourceUrls: ['https://example.test/article'],
    requestedTopic: 'Topik URL baseline',
    sentinel: { keep: 'same-object' }
  };
  let received = null;
  let calls = 0;

  generation.generateAndSave = async value => {
    calls += 1;
    received = value;
    return 155;
  };

  try {
    const wrapped = autoSourcePatch.install();
    const result = await wrapped(args);

    assert.equal(result, 155);
    assert.equal(calls, 1);
    assert.strictEqual(received, args, 'Pakai URL args must be forwarded without cloning or rewriting');
    for (const modulePath of AUTO_SOURCE_MODULES) {
      assert.equal(require.cache[require.resolve(modulePath)], undefined, `${modulePath} must stay unloaded for Pakai URL`);
    }
  } finally {
    autoSourcePatch.resetForTests();
    generation.generateAndSave = realGenerateAndSave;
  }
});
