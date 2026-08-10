const test = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const { generateAndSave } = require('../src/services/generation');

const sourceFetcher = {
  validateSourceUrls: urls => urls,
  fetchSources: async urls => [{
    url: urls[0], finalUrl: urls[0], title: '5 Daftar Buah yang Dapat Meningkatkan Daya Ingat',
    text: 'Apel mengandung quercetin yang dibahas dalam artikel. Alpukat mengandung lemak tak jenuh yang dibahas dalam artikel. Buah beri mengandung antosianin yang dibahas dalam artikel.',
    fetchedAt: '2026-08-11T00:00:00.000Z'
  }],
  buildSourceContext: () => '<SOURCE>clean main article</SOURCE>'
};

function generated(topic) {
  return {
    focus: { masalah: 'Memahami topik', penyebab: 'Artikel utama', solusi: 'Rangkum fakta', hasil: 'Konten source-backed' },
    topic,
    hook: 'Apel dan daya ingat',
    body: 'Apel menjadi salah satu buah yang dibahas dalam artikel sumber untuk topik daya ingat.',
    caption: 'Apel menjadi salah satu buah yang dibahas dalam artikel sumber untuk topik daya ingat.',
    hashtags: [], cta: 'Jambu biji dan daya ingat', trendKeywordsUsed: [],
    content_angle: topic, primary_tool: 'tanpa tool', hook_pattern: 'source-backed',
    verificationStatus: 'source_based', unsupportedClaims: [],
    slides: Array.from({ length: 5 }, (_, index) => ({
      section: `ITEM ${index + 1}`,
      title: `Buah ${index + 1}`,
      body: `Fakta sumber yang cukup panjang untuk item ${index + 1} dan tetap membahas topik manual secara langsung.`,
      points: ['Detail pendukung dari sumber'],
      claims: []
    }))
  };
}

test('Manual + URL memakai source-first composer dan melewati legacy sourceFilter/role repair', async () => {
  const db = createDatabase(':memory:');
  let composerCalls = 0;
  let sourceFilterCalls = 0;
  let roleGuardCalls = 0;
  let renderedFormat = '';

  const manualSourceComposer = {
    async composeManualSourceContent({ options, sources }) {
      composerCalls += 1;
      assert.equal(options.topicSource, 'manual');
      assert.equal(options.contentFormat, 'Listicle');
      assert.equal(sources.length, 1);
      return generated(options.requestedTopic);
    }
  };
  const sourceFilter = {
    async generateFilteredContent() { sourceFilterCalls += 1; throw new Error('legacy filter tidak boleh dipanggil'); }
  };
  const manualSourceRoleGuard = {
    async repairManualSourceRoles() { roleGuardCalls += 1; throw new Error('legacy role guard tidak boleh dipanggil'); }
  };
  const images = {
    async createSlides(_key, options) {
      renderedFormat = options.contentFormat;
      return ['/generated/1.jpg', '/generated/2.jpg', '/generated/3.jpg', '/generated/4.jpg', '/generated/5.jpg'];
    }
  };

  const id = await generateAndSave({
    db, mode: 'manual', requestedTopic: 'Daya ingat', format: 'Listicle', useSources: true,
    sourceUrls: ['https://example.test/daya-ingat'], sourceFetcher,
    content: { generateContent: async () => { throw new Error('generic draft tidak boleh dibuat'); } },
    sourceFilter, manualSourceRoleGuard, manualSourceComposer, images, useTrendReference: false
  });

  assert.equal(composerCalls, 1);
  assert.equal(sourceFilterCalls, 0);
  assert.equal(roleGuardCalls, 0);
  assert.equal(renderedFormat, 'Listicle');
  assert.equal(db.prepare('SELECT topic,content_format FROM contents WHERE id=?').get(id).topic, 'Daya ingat');
  db.close();
});

test('AI + URL tidak dialihkan ke Manual composer', async () => {
  const db = createDatabase(':memory:');
  let composerCalls = 0;
  let filterCalls = 0;
  const manualSourceComposer = { async composeManualSourceContent() { composerCalls += 1; throw new Error('tidak boleh'); } };
  const sourceFilter = { async generateFilteredContent() { filterCalls += 1; return generated('Topik AI sumber unik'); } };
  const images = { async createSlides() { return ['/generated/slide.jpg']; } };

  await generateAndSave({
    db, mode: 'ai', format: 'Listicle', useSources: true,
    sourceUrls: ['https://example.test/ai'], sourceFetcher,
    content: { generateContent: async () => generated('Topik AI sumber unik') },
    sourceFilter, manualSourceComposer, images, useTrendReference: false
  });

  assert.equal(composerCalls, 0);
  assert.equal(filterCalls, 1);
  db.close();
});
