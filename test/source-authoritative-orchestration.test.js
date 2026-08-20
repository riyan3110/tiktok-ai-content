const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const sourceFilter = require('../src/services/sourceFilter');
const fallback = require('../src/services/manualSourceFallback');
// Alternate hosts and direct createApp imports can load sourceUrlFinalizer before
// sourceSafetyPatch. Keep that order here to catch cached validator references.
const finalizer = require('../src/services/sourceUrlFinalizer');
const safety = require('../src/services/sourceSafetyPatch');
const { finalizeSourceCandidate } = require('../src/services/generation');
const genericFixtures = require('./fixtures/generic-source-cases.json');

function genericEnglishSource() {
  return [{
    url: 'https://example.test/northstar-browser',
    title: 'Northstar Browser Efficiency Study',
    text: [
      'Northstar Browser was derived from the Cedar rendering engine during development.',
      'The browser can reduce memory use when many tabs remain open.',
      'The team plans to release the mobile edition next quarter.',
      'Tests associated the cache setting with shorter startup time.',
      'The browser includes local profile controls for shared computers.',
      'Developers published migration notes for extension authors.',
      'The desktop edition supports four workspace groups.',
      'Administrators may disable background synchronization.'
    ].join(' ')
  }];
}

function validCandidate(sources, format = 'Fakta singkat') {
  return fallback.buildDeterministicSourceFallback({
    generated: { topic: 'Northstar Browser', effectiveContentFormat: format },
    sources,
    topic: 'Northstar Browser',
    requestedFormat: format
  });
}

test('sourceUrlFinalizer tetap memakai validator aktif pada alternate load order', async t => {
  const sources = genericEnglishSource();
  const candidate = validCandidate(sources);
  const originalFilterValidate = sourceFilter.validateVerifiedContent;
  const originalAudit = sourceFilter.auditClaimSemantics;
  sourceFilter.validateVerifiedContent = content => ({ content, errors: [] });
  sourceFilter.auditClaimSemantics = async () => [];

  safety.install();
  const activeAfterInstall = fallback.validateSourceContent;
  fallback.validateSourceContent = () => ['authoritative-validator-sentinel'];
  t.after(() => {
    sourceFilter.validateVerifiedContent = originalFilterValidate;
    sourceFilter.auditClaimSemantics = originalAudit;
    fallback.validateSourceContent = activeAfterInstall;
  });

  const client = { chat: { completions: { create: async () => ({
    choices: [{ message: { content: JSON.stringify({ slides: candidate.slides }) } }]
  }) } } };

  await assert.rejects(
    finalizer.rewriteAllSourcesWithAi({ generated: candidate, sources, topic: 'Northstar Browser', format: 'Fakta singkat', client }),
    error => error.status === 422 && error.validationErrors.includes('authoritative-validator-sentinel')
  );
});

test('candidate valid langsung lolos tanpa repair sia-sia', async t => {
  const original = fallback.validateSourceContent;
  fallback.validateSourceContent = () => [];
  t.after(() => { fallback.validateSourceContent = original; });
  let repairs = 0;
  const candidate = { topic: 'Lentera OS', slides: [] };
  const result = await finalizeSourceCandidate({
    generated: candidate,
    sources: [],
    repair: async () => { repairs += 1; return {}; }
  });
  assert.equal(result, candidate);
  assert.equal(repairs, 0);
});

test('candidate fragmen menjalani tepat satu repair lalu authoritative validation kedua', async t => {
  const original = fallback.validateSourceContent;
  let validations = 0;
  fallback.validateSourceContent = candidate => {
    validations += 1;
    return candidate.repaired ? [] : ['slide:0:natural: body berakhir sebagai fragmen kalimat.'];
  };
  t.after(() => { fallback.validateSourceContent = original; });
  let repairs = 0;
  const result = await finalizeSourceCandidate({
    generated: { topic: 'Pijar Keyboard' },
    sources: [],
    repair: async ({ validationErrors }) => {
      repairs += 1;
      assert.match(validationErrors[0], /fragmen/);
      return { topic: 'Pijar Keyboard', repaired: true };
    }
  });
  assert.equal(result.repaired, true);
  assert.equal(repairs, 1);
  assert.equal(validations, 2);
});

test('semantic drift menjalani satu repair dan hubungan evidence dipertahankan', async t => {
  const original = fallback.validateSourceContent;
  let validations = 0;
  fallback.validateSourceContent = candidate => {
    validations += 1;
    return /penerus/i.test(candidate.body) ? ['slide:0:body: hubungan lineage berubah.'] : [];
  };
  t.after(() => { fallback.validateSourceContent = original; });
  let repairs = 0;
  const result = await finalizeSourceCandidate({
    generated: { body: 'Northstar adalah penerus Cedar.' },
    sources: genericEnglishSource(),
    repair: async () => {
      repairs += 1;
      return { body: 'Northstar diturunkan dari mesin Cedar.' };
    }
  });
  assert.match(result.body, /diturunkan dari/);
  assert.equal(repairs, 1);
  assert.equal(validations, 2);
});

test('repair yang masih invalid gagal 422 setelah satu cycle', async t => {
  const original = fallback.validateSourceContent;
  let validations = 0;
  fallback.validateSourceContent = () => {
    validations += 1;
    return ['slide:0:natural: body berakhir sebagai fragmen kalimat.'];
  };
  t.after(() => { fallback.validateSourceContent = original; });
  let repairs = 0;
  await assert.rejects(finalizeSourceCandidate({
    generated: { topic: 'Harbor Battery' },
    sources: [],
    repair: async () => { repairs += 1; return { topic: 'Harbor Battery' }; }
  }), error => error.status === 422 && /final source gate/i.test(error.message));
  assert.equal(repairs, 1);
  assert.equal(validations, 2);
});

test('fixture generik mencakup bahasa, domain, richness, thin source, dan Listicle eksplisit', () => {
  assert.match(genericFixtures.englishTechnology.text, /derived from|plans to/i);
  assert.match(genericFixtures.indonesianTechnology.text, /Pengguna dapat/);
  assert.match(genericFixtures.englishGeneralTechnology.text, /Battery|field trial/i);
  assert.ok(fallback.sourceFacts([genericFixtures.richSource]).length >= 8);
  assert.ok(fallback.sourceFacts([genericFixtures.thinSource]).length >= 4);
  assert.equal(fallback.requestedListicleCount([genericFixtures.explicitListicle], ''), 5);
  const listicle = fallback.buildDeterministicSourceFallback({
    generated: { topic: genericFixtures.explicitListicle.title },
    sources: [genericFixtures.explicitListicle],
    topic: genericFixtures.explicitListicle.title,
    requestedFormat: 'Listicle'
  });
  assert.deepEqual(listicle.slides.map(slide => slide.section), ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4', 'ITEM 5']);
});
