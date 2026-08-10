const test = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const { generateAndSave } = require('../src/services/generation');

const sourceFetcher = {
  validateSourceUrls: urls => urls,
  fetchSources: async urls => [{
    url: urls[0], finalUrl: urls[0], title: 'Sumber',
    text: 'Fakta pertama dari sumber. Fakta kedua dari sumber. Fakta ketiga dari sumber. Fakta keempat dari sumber.',
    fetchedAt: '2026-08-10T00:00:00.000Z'
  }],
  buildSourceContext: () => '<SOURCE id="source-1">Fakta sumber.</SOURCE>'
};

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
    slides: [
      { section: 'PEMBUKA', title: 'Pembuka', body: 'Isi pertama', points: [], claims: [] },
      { section: 'FAKTA UTAMA', title: 'Fakta', body: 'Isi kedua', points: [], claims: [] },
      { section: 'PENJELASAN', title: 'Penjelasan', body: 'Isi ketiga', points: [], claims: [] },
      { section: 'KESIMPULAN', title: 'Kesimpulan', body: 'Isi keempat', points: [], claims: [] }
    ]
  };
}

test('effective Fakta singkat diteruskan ke renderer, database, dan render_source', async () => {
  const db = createDatabase(':memory:');
  let renderedFormat;
  const images = {
    async createSlides(_key, options) {
      renderedFormat = options.contentFormat;
      return ['/generated/slide.jpg'];
    }
  };
  const sourceFilter = {
    async generateFilteredContent() { return generated('Topik manual effective format'); }
  };
  const manualSourceDedupe = {
    async repairManualSourceDuplicates({ generated: value }) { return value; }
  };
  const manualSourceRoleGuard = {
    async repairManualSourceRoles({ generated: value }) {
      return { ...value, effectiveContentFormat: 'Fakta singkat' };
    }
  };

  const id = await generateAndSave({
    db,
    mode: 'manual',
    requestedTopic: 'Topik manual effective format',
    format: 'Tutorial langkah',
    useSources: true,
    sourceUrls: ['https://example.test/manual'],
    content: { generateContent: async () => generated('Topik manual effective format') },
    sourceFetcher,
    sourceFilter,
    manualSourceDedupe,
    manualSourceRoleGuard,
    images,
    useTrendReference: false
  });

  const row = db.prepare('SELECT content_format,render_source FROM contents WHERE id=?').get(id);
  const renderSource = JSON.parse(row.render_source);
  assert.equal(renderedFormat, 'Fakta singkat');
  assert.equal(row.content_format, 'Fakta singkat');
  assert.equal(renderSource.contentFormat, 'Fakta singkat');
  db.close();
});
