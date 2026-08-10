const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

test('createApp meneruskan manualSourceRoleGuard khusus ke Manual + URL', async (t) => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());

  let contentCalls = 0;
  let guardCalls = 0;
  const content = {
    async generateContent() {
      contentCalls += 1;
      throw new Error('Manual + URL tidak boleh memakai generator awal setelah structural seed aktif');
    }
  };
  const sourceFetcher = {
    validateSourceUrls(urls) { return urls; },
    async fetchSources(urls) {
      return [{
        url: urls[0],
        finalUrl: urls[0],
        title: 'Dokumen sumber',
        text: 'Fakta artikel utama yang cukup untuk membuktikan dependency guard diteruskan melalui createApp.',
        fetchedAt: new Date().toISOString()
      }];
    },
    buildSourceContext() { return '<SOURCE id="source-1">CONTENT</SOURCE>'; }
  };
  const manualSourceRoleGuard = {
    async repairManualSourceRoles({ generated, options, sources, contentService }) {
      guardCalls += 1;
      assert.equal(contentService, content);
      assert.equal(options.requestedTopic, 'Tema guard');
      assert.equal(sources.length, 1);
      return {
        ...generated,
        topic: 'Tema guard',
        hook: 'Ringkasan Tema guard',
        body: 'Fakta artikel utama dipakai oleh guard khusus.',
        caption: 'Fakta artikel utama dipakai oleh guard khusus.',
        cta: 'Selesai',
        verificationStatus: 'source_based',
        slides: generated.slides.map((slide, index) => ({
          ...slide,
          title: `Bagian ${index + 1}`,
          body: `Isi sumber bagian ${index + 1}`
        }))
      };
    }
  };
  const images = {
    async createSlides() {
      return ['/generated/guard-1.jpg', '/generated/guard-2.jpg', '/generated/guard-3.jpg', '/generated/guard-4.jpg'];
    },
    async validateSlides() {}
  };

  const app = createApp({
    db,
    content,
    images,
    sourceFetcher,
    manualSourceRoleGuard,
    trending: { async getLatest() { return []; } }
  });

  const response = await request(app)
    .post('/generate')
    .send({
      topicSource: 'manual',
      requestedTopic: 'Tema guard',
      contentFormat: 'Fakta singkat',
      useSources: true,
      sourceUrls: ['https://example.test/article']
    })
    .expect(200);

  assert.equal(guardCalls, 1);
  assert.equal(contentCalls, 0);
  assert.equal(response.body.topic, 'Tema guard');
  assert.equal(response.body.render_source.verificationStatus, 'source_based');
});
