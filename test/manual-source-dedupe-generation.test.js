const test = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const { generateAndSave } = require('../src/services/generation');

const sourceFetcher = {
  validateSourceUrls: urls => urls,
  fetchSources: async urls => [{
    url: urls[0], finalUrl: urls[0], title: 'Sumber',
    text: 'Fakta pertama dari sumber. Fakta kedua dari sumber.',
    fetchedAt: '2026-08-10T00:00:00.000Z'
  }],
  buildSourceContext: () => '<SOURCE id="source-1">Fakta pertama dari sumber. Fakta kedua dari sumber.</SOURCE>'
};

const images = { createSlides: async () => ['/generated/slide.jpg'] };

function generated(topic) {
  return {
    focus: { masalah: 'Konteks', penyebab: 'Sumber', solusi: 'Verifikasi', hasil: 'Ringkas' },
    topic,
    hook: 'Hook sumber',
    body: 'Isi sumber',
    caption: 'Isi sumber',
    hashtags: [],
    cta: 'Ringkasan',
    trendKeywordsUsed: [],
    content_angle: 'fakta sumber',
    primary_tool: 'tanpa tool',
    hook_pattern: 'langsung',
    verificationStatus: 'source_based',
    slides: [{ section: 'ITEM 1', title: 'Judul', body: 'Isi sumber', points: [], claims: [] }]
  };
}

test('generation menjalankan dedupe tambahan hanya untuk Manual + URL', async () => {
  const db = createDatabase(':memory:');
  let filterCalls = 0;
  let dedupeCalls = 0;
  const sourceFilter = {
    async generateFilteredContent({ options }) {
      filterCalls += 1;
      assert.equal(options.topicSource, 'manual');
      assert.equal(options.useSources, true);
      return generated('Topik manual dedupe');
    }
  };
  const manualSourceDedupe = {
    async repairManualSourceDuplicates({ generated: value, options, sources }) {
      dedupeCalls += 1;
      assert.equal(options.topicSource, 'manual');
      assert.equal(options.useSources, true);
      assert.equal(sources.length, 1);
      return value;
    }
  };

  const id = await generateAndSave({
    db,
    mode: 'manual',
    requestedTopic: 'Topik manual dedupe',
    useSources: true,
    sourceUrls: ['https://example.test/manual'],
    content: { generateContent: async () => generated('Topik manual dedupe') },
    sourceFetcher,
    sourceFilter,
    manualSourceDedupe,
    images,
    useTrendReference: false
  });

  assert.equal(filterCalls, 1);
  assert.equal(dedupeCalls, 1);
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Topik manual dedupe');
  db.close();
});

test('generation tidak menjalankan manual dedupe pada AI + URL', async () => {
  const db = createDatabase(':memory:');
  let dedupeCalls = 0;
  const sourceFilter = { async generateFilteredContent() { return generated('Topik AI sumber unik'); } };
  const manualSourceDedupe = { async repairManualSourceDuplicates({ generated: value }) { dedupeCalls += 1; return value; } };

  const id = await generateAndSave({
    db,
    mode: 'ai',
    useSources: true,
    sourceUrls: ['https://example.test/ai'],
    content: { generateContent: async () => generated('Topik AI sumber unik') },
    sourceFetcher,
    sourceFilter,
    manualSourceDedupe,
    images,
    useTrendReference: false
  });

  assert.equal(dedupeCalls, 0);
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Topik AI sumber unik');
  db.close();
});
