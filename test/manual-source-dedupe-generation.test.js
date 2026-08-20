const test = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const { generateAndSave, resolveManualSourceRoleGuard } = require('../src/services/generation');

const sourceFetcher = {
  validateSourceUrls: urls => urls,
  fetchSources: async urls => [{
    url: urls[0], finalUrl: urls[0], title: 'Sumber',
    text: 'Fakta pertama dari sumber. Fakta kedua dari sumber. Fakta ketiga dari sumber.',
    fetchedAt: '2026-08-10T00:00:00.000Z'
  }],
  buildSourceContext: () => '<SOURCE id="source-1">Fakta sumber.</SOURCE>'
};

const images = { createSlides: async () => ['/generated/slide.jpg'] };

function generated(topic) {
  return {
    focus: { masalah: 'Konteks', penyebab: 'Sumber', solusi: 'Verifikasi', hasil: 'Ringkas' },
    topic,
    hook: 'Hook sumber', body: 'Isi sumber', caption: 'Isi sumber', hashtags: [], cta: 'Ringkasan',
    trendKeywordsUsed: [], content_angle: 'fakta sumber', primary_tool: 'tanpa tool', hook_pattern: 'langsung',
    verificationStatus: 'source_based',
    slides: [
      { section: 'ITEM 1', title: 'Fakta 1', body: 'Isi sumber yang cukup untuk fakta pertama.', points: [], claims: [] },
      { section: 'ITEM 2', title: 'Fakta 2', body: 'Isi sumber yang cukup untuk fakta kedua.', points: [], claims: [] },
      { section: 'ITEM 3', title: 'Fakta 3', body: 'Isi sumber yang cukup untuk fakta ketiga.', points: [], claims: [] },
      { section: 'ITEM 4', title: 'Fakta 4', body: 'Isi sumber yang cukup untuk fakta keempat.', points: [], claims: [] }
    ]
  };
}

test('default final Manual source guard selalu tersedia meski content service di-inject', () => {
  const guard = resolveManualSourceRoleGuard();
  assert.ok(guard);
  assert.equal(typeof guard.repairManualSourceRoles, 'function');
});

test('Manual + URL melewati pre-verifier dan selalu masuk satu final all-format quality gate', async () => {
  const db = createDatabase(':memory:');
  let filterCalls = 0;
  let contentCalls = 0;
  let qualityCalls = 0;
  const sourceFilter = { async generateFilteredContent() { filterCalls += 1; return generated('Tidak boleh dipakai'); } };
  const content = { async generateContent() { contentCalls += 1; return generated('Tidak boleh dipakai'); } };
  const manualSourceRoleGuard = {
    async repairManualSourceRoles({ generated: seed, options, sources }) {
      qualityCalls += 1;
      assert.equal(options.topicSource, 'manual');
      assert.equal(options.useSources, true);
      assert.equal(options.contentFormat, 'Listicle');
      assert.equal(sources.length, 1);
      assert.equal(seed.topic, 'Topik manual final gate');
      assert.deepEqual(seed.slides.map(slide => slide.section), ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4']);
      return generated('Topik manual final gate');
    }
  };

  const id = await generateAndSave({
    db, mode: 'manual', requestedTopic: 'Topik manual final gate', format: 'Listicle', useSources: true,
    sourceUrls: ['https://example.test/manual'],
    content, sourceFetcher, sourceFilter, manualSourceRoleGuard, images, useTrendReference: false
  });

  assert.equal(filterCalls, 0, 'Manual + URL tidak boleh masuk sourceFilter pre-verifier yang mengunci section lama');
  assert.equal(contentCalls, 0, 'Manual + URL ditulis oleh final source gate, bukan generator awal kedua');
  assert.equal(qualityCalls, 1);
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Topik manual final gate');
  db.close();
});

test('AI + URL tetap memakai sourceFilter dan tidak menjalankan final Manual quality gate', async () => {
  const db = createDatabase(':memory:');
  let filterCalls = 0;
  let qualityCalls = 0;
  const sourceFilter = { async generateFilteredContent() { filterCalls += 1; return generated('Topik AI sumber unik'); } };
  const manualSourceRoleGuard = { async repairManualSourceRoles({ generated: value }) { qualityCalls += 1; return value; } };

  const id = await generateAndSave({
    db, mode: 'ai', useSources: true, sourceUrls: ['https://example.test/ai'],
    content: { generateContent: async () => generated('Topik AI sumber unik') },
    sourceFetcher, sourceFilter, manualSourceRoleGuard, images, useTrendReference: false
  });

  assert.equal(filterCalls, 1);
  assert.equal(qualityCalls, 0);
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Topik AI sumber unik');
  db.close();
});
