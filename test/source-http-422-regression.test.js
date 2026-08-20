const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

test('source-backed validation failure mengembalikan JSON 422 tanpa render atau save', async t => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  let renders = 0;
  const app = createApp({
    db,
    content: { async generateContent() { throw new Error('generator awal tidak boleh dipakai'); } },
    images: {
      async createSlides() { renders += 1; return ['/generated/invalid.jpg']; },
      async validateSlides() {}
    },
    sourceFetcher: {
      validateSourceUrls: urls => urls,
      async fetchSources(urls) {
        return [{
          url: urls[0], finalUrl: urls[0], title: 'Harbor Battery Field Trial',
          text: 'Harbor Battery completed a field trial. The operator may expand the trial next year.',
          fetchedAt: new Date().toISOString()
        }];
      },
      buildSourceContext: () => '<SOURCE id="source-1">Harbor Battery field trial.</SOURCE>'
    },
    manualSourceRoleGuard: {
      async repairManualSourceRoles() {
        throw Object.assign(new Error('Konten URL belum memenuhi final source gate: slide:0:natural: body berakhir sebagai fragmen kalimat.'), {
          status: 422,
          validationErrors: ['slide:0:natural: body berakhir sebagai fragmen kalimat.']
        });
      }
    },
    trending: { async getLatest() { return []; } }
  });

  const response = await request(app).post('/generate').send({
    topicSource: 'manual',
    requestedTopic: 'Harbor Battery',
    contentFormat: 'Fakta singkat',
    useSources: true,
    sourceUrls: ['https://example.test/harbor-battery']
  }).expect(422).expect('Content-Type', /json/);

  assert.match(response.body.error, /final source gate/i);
  assert.equal(renders, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM contents').get().count, 0);
});
