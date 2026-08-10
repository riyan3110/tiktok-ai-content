const test = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const { generateAndSave } = require('../src/services/generation');

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
      { section: 'PEMBUKA', title: 'Judul', body: 'Isi sumber yang cukup untuk pembuka.', points: [], claims: [] },
      { section: 'FAKTA UTAMA', title: 'Fakta', body: 'Isi sumber yang cukup untuk fakta utama.', points: [], claims: [] },
      { section: 'PENJELASAN', title: 'Penjelasan', body: 'Isi sumber yang cukup untuk penjelasan.', points: [], claims: [] },
      { section: 'KESIMPULAN', title: 'Ringkasan', body: 'Isi sumber yang cukup untuk penutup.', points: [], claims: [] }
    ]
  };
}

test('generation menjalankan satu final quality gate hanya untuk Manual + URL', async () => {
  const db = createDatabase(':memory:');
  let filterCalls = 0;
  let qualityCalls = 0;
  const sourceFilter = {
    async generateFilteredContent({ options }) {
      filterCalls += 1;
      assert.equal(options.topicSource, 'manual');
      assert.equal(options.useSources, true);
      return generated('Topik manual final gate');
    }
  };
  const manualSourceRoleGuard = {
    async repairManualSourceRoles({ generated: value, options, sources }) {
      qualityCalls += 1;
      assert.equal(options.topicSource, 'manual');
      assert.equal(options.useSources, true);
      assert.equal(sources.length, 1);
      return value;
    }
  };

  const id = await generateAndSave({
    db, mode: 'manual', requestedTopic: 'Topik manual final gate', useSources: true,
    sourceUrls: ['https://example.test/manual'],
    content: { generateContent: async () => generated('Topik manual final gate') },
    sourceFetcher, sourceFilter, manualSourceRoleGuard, images, useTrendReference: false
  });

  assert.equal(filterCalls, 1);
  assert.equal(qualityCalls, 1);
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Topik manual final gate');
  db.close();
});

test('generation tidak menjalankan final Manual quality gate pada AI + URL', async () => {
  const db = createDatabase(':memory:');
  let qualityCalls = 0;
  const sourceFilter = { async generateFilteredContent() { return generated('Topik AI sumber unik'); } };
  const manualSourceRoleGuard = { async repairManualSourceRoles({ generated: value }) { qualityCalls += 1; return value; } };

  const id = await generateAndSave({
    db, mode: 'ai', useSources: true, sourceUrls: ['https://example.test/ai'],
    content: { generateContent: async () => generated('Topik AI sumber unik') },
    sourceFetcher, sourceFilter, manualSourceRoleGuard, images, useTrendReference: false
  });

  assert.equal(qualityCalls, 0);
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Topik AI sumber unik');
  db.close();
});
