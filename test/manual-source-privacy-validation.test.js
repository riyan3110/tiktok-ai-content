const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const sourceFilter = require('../src/services/sourceFilter');
const { filterManualPrivacyBoilerplateErrors } = require('../src/services/manualSourceRoleGuard');

function candidate(body) {
  return {
    topic: 'Privasi WhatsApp',
    hook: 'Privasi WhatsApp',
    body,
    caption: body,
    cta: 'Ringkasan',
    hashtags: [],
    slides: [{
      section: 'ITEM 1',
      title: 'Pengaturan akun',
      body,
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: body,
        sourceId: 'source-1',
        evidence: body
      }]
    }]
  };
}

test('Manual final gate tidak menganggap fakta privasi sebagai boilerplate situs', () => {
  const body = 'Pengguna dapat membatasi informasi akun melalui pengaturan privasi WhatsApp yang tersedia pada menu pengaturan aplikasi.';
  const content = candidate(body);
  const checked = sourceFilter.validateVerifiedContent(content, { slides: content.slides }, {
    contentService: { validateContent() { return []; } },
    format: 'Listicle',
    manualTopic: 'Privasi WhatsApp',
    sources: [{ title: 'Privasi WhatsApp', text: body }],
    autoSourceTopic: false
  });
  assert.ok(checked.errors.some(error => /metadata\/boilerplate website/.test(error)), 'validator lama memang memicu false positive bare privasi');
  const filtered = filterManualPrivacyBoilerplateErrors(checked.errors, checked.content);
  assert.equal(filtered.some(error => /metadata\/boilerplate website/.test(error)), false);
});

test('Manual final gate tetap menolak privacy-policy metadata', () => {
  const content = candidate('Kebijakan privasi situs menjelaskan cookie dan ketentuan layanan untuk seluruh pengunjung situs ini.');
  const errors = ['slide:0:body: metadata/boilerplate website masuk ke konten.'];
  assert.deepEqual(filterManualPrivacyBoilerplateErrors(errors, content), errors);
});
