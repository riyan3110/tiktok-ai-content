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

test('Manual final gate tidak menganggap fakta privasi source-backed sebagai boilerplate situs', () => {
  const body = 'Pengguna dapat membatasi informasi akun melalui pengaturan privasi WhatsApp yang tersedia pada menu pengaturan aplikasi.';
  const content = candidate(body);
  const sources = [{ title: 'Privasi WhatsApp', text: body }];
  const checked = sourceFilter.validateVerifiedContent(content, { slides: content.slides }, {
    contentService: { validateContent() { return []; } },
    format: 'Listicle',
    manualTopic: 'Privasi WhatsApp',
    sources,
    autoSourceTopic: false
  });
  assert.ok(checked.errors.some(error => /metadata\/boilerplate website/.test(error)), 'validator lama memang memicu false positive bare privasi');
  const filtered = filterManualPrivacyBoilerplateErrors(checked.errors, checked.content, sources);
  assert.equal(filtered.some(error => /metadata\/boilerplate website/.test(error)), false);
});

test('Manual final gate menerima aksi login bila copy dan evidence benar-benar berasal dari artikel', () => {
  const body = 'Pengguna dapat login ke akun resmi lalu memeriksa perangkat tertaut dari menu pengaturan keamanan akun.';
  const content = candidate(body);
  const sources = [{ title: 'Cara memeriksa keamanan akun', text: body }];
  const errors = ['slide:0:body: metadata/boilerplate website masuk ke konten.'];
  assert.deepEqual(filterManualPrivacyBoilerplateErrors(errors, content, sources), []);
});

test('Manual final gate tetap menolak privacy-policy metadata', () => {
  const body = 'Kebijakan privasi situs menjelaskan cookie dan ketentuan layanan untuk seluruh pengunjung situs ini.';
  const content = candidate(body);
  const errors = ['slide:0:body: metadata/boilerplate website masuk ke konten.'];
  assert.deepEqual(filterManualPrivacyBoilerplateErrors(errors, content, [{ title: 'Situs', text: body }]), errors);
});

test('kata privasi tidak boleh menyamarkan boilerplate lain yang tetap terlarang', () => {
  const errors = ['slide:0:body: metadata/boilerplate website masuk ke konten.'];
  for (const body of [
    'Baca juga panduan privasi WhatsApp untuk pengguna lain.',
    'Copyright 2026 membahas privasi WhatsApp pada halaman situs.',
    'Newsletter privasi WhatsApp tersedia untuk pelanggan situs.'
  ]) {
    assert.deepEqual(filterManualPrivacyBoilerplateErrors(errors, candidate(body), [{ title: 'Situs', text: body }]), errors, body);
  }
});

test('login yang tidak punya evidence canonical tetap ditolak sebagai boilerplate', () => {
  const body = 'Login untuk mengatur privasi WhatsApp melalui halaman situs.';
  const errors = ['slide:0:body: metadata/boilerplate website masuk ke konten.'];
  assert.deepEqual(filterManualPrivacyBoilerplateErrors(errors, candidate(body), [{ title: 'Artikel', text: 'Artikel utama tidak memuat instruksi login tersebut.' }]), errors);
});
