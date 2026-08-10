const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { deterministicRoleErrors, inferListicleCount, manualEvidenceCandidates } = require('../src/services/manualSourceRoleGuard');

const bank = count => Array.from({ length: count }, (_, index) => ({
  sourceId: 'source-1',
  evidence: `Fakta utama ${index + 1} berbeda dan berasal dari artikel utama.`
}));

const slide = section => ({ section, title: section, body: 'Isi sumber yang substantif dan berbeda.', points: [], claims: [] });

test('Listicle sumber kaya menolak slot pembuka/penutup yang menggantikan fakta utama', () => {
  const content = {
    slides: [
      slide('PEMBUKA'),
      slide('ITEM 1'),
      slide('ITEM 2'),
      slide('ITEM 3'),
      slide('KESIMPULAN')
    ]
  };

  const errors = deterministicRoleErrors(content, 'Listicle', { bank: bank(5), expectedListicleCount: 5 });
  assert.ok(errors.some(error => /semua slide Listicle sumber kaya wajib berupa ITEM/i.test(error)));
});

test('Listicle sumber kaya menerima semua fakta sebagai ITEM 1..5 berurutan', () => {
  const content = { slides: Array.from({ length: 5 }, (_, index) => slide(`ITEM ${index + 1}`)) };
  assert.deepEqual(deterministicRoleErrors(content, 'Listicle', { bank: bank(8), expectedListicleCount: 5 }), []);
});

test('jumlah item mengikuti daftar eksplisit judul, bukan jumlah kalimat FACT_BANK', () => {
  const sources = [{ title: '4 Cara Menjaga Akun Tetap Aman', text: 'Fakta sumber.'.repeat(20) }];
  assert.equal(inferListicleCount(sources, 'Keamanan akun'), 4);

  const valid = { slides: Array.from({ length: 4 }, (_, index) => slide(`ITEM ${index + 1}`)) };
  assert.deepEqual(deterministicRoleErrors(valid, 'Listicle', { bank: bank(9), expectedListicleCount: 4 }), []);

  const inventedFifth = { slides: Array.from({ length: 5 }, (_, index) => slide(`ITEM ${index + 1}`)) };
  const errors = deterministicRoleErrors(inventedFifth, 'Listicle', { bank: bank(9), expectedListicleCount: 4 });
  assert.ok(errors.some(error => /judul sumber menyatakan 4 item/i.test(error)));
});

test('judul Beautynesia 5 daftar dibaca sebagai lima item', () => {
  assert.equal(inferListicleCount([{ title: '5 Daftar Buah yang Dapat Meningkatkan Daya Ingat' }], 'Daya ingat'), 5);
});

test('fakta source-backed tentang login tidak dibuang sebagai metadata saat membangun FACT_BANK', () => {
  const candidates = manualEvidenceCandidates('Pengguna dapat login ke akun resmi lalu memeriksa perangkat tertaut untuk memastikan sesi yang aktif.');
  assert.equal(candidates.length, 1);
  assert.match(candidates[0], /login ke akun resmi/i);
});
