const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { deterministicRoleErrors } = require('../src/services/manualSourceRoleGuard');

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

  const errors = deterministicRoleErrors(content, 'Listicle', { bank: bank(5) });
  assert.ok(errors.some(error => /semua slide Listicle sumber kaya wajib berupa ITEM/i.test(error)));
});

test('Listicle sumber kaya menerima semua fakta sebagai ITEM 1..5 berurutan', () => {
  const content = { slides: Array.from({ length: 5 }, (_, index) => slide(`ITEM ${index + 1}`)) };
  assert.deepEqual(deterministicRoleErrors(content, 'Listicle', { bank: bank(5) }), []);
});

test('Listicle dengan empat fakta utama memakai tepat empat ITEM', () => {
  const valid = { slides: Array.from({ length: 4 }, (_, index) => slide(`ITEM ${index + 1}`)) };
  assert.deepEqual(deterministicRoleErrors(valid, 'Listicle', { bank: bank(4) }), []);

  const wastesSlot = { slides: [...valid.slides, slide('KESIMPULAN')] };
  const errors = deterministicRoleErrors(wastesSlot, 'Listicle', { bank: bank(4) });
  assert.ok(errors.some(error => /tepat 4 slide/i.test(error)));
});
