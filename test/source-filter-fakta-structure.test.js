const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  normalizeFactSections,
  extractFactBank,
  auditClaimSemantics
} = require('../src/services/sourceFilter');

test('Fakta singkat mengganti label problem-solution menjadi section fakta netral', () => {
  const slides = [
    { section: 'intro', title: 'Pembuka', body: 'Isi', points: [] },
    { section: 'penyebab', title: 'Fakta', body: 'Isi', points: [] },
    { section: 'solusi', title: 'Konteks', body: 'Isi', points: [] },
    { section: 'hasil', title: 'Penutup', body: 'Isi', points: [] }
  ];

  const normalized = normalizeFactSections(slides, 'Fakta singkat');
  assert.deepEqual(normalized.map(slide => slide.section), ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN']);
  assert.deepEqual(normalized.map(slide => slide.title), slides.map(slide => slide.title));
});

test('fact bank memprioritaskan bagian artikel yang sejalur dengan judul/topik', () => {
  const sources = [{
    title: 'Robots Learn Laundry Folding for the Home',
    text: [
      'Robots are learning to fold laundry in home environments.',
      'Laundry folding requires robots to handle changing fabric shapes.',
      'Robots can practice folding clothes while staying in one area.',
      'Folding laundry is being used as an entry task for home robots.',
      'Company additionally discussed an unrelated mine-clearing research project.'
    ].join(' ')
  }];

  const bank = extractFactBank(sources, 'Kenapa robot disuruh melipat baju?');
  assert.ok(bank.length >= 4);
  assert.ok(bank.every(item => !/mine-clearing/i.test(item.evidence)));
  assert.ok(bank.some(item => /laundry/i.test(item.evidence)));
});

test('audit semantik menolak evidence valid yang tidak membuktikan arti claim', async () => {
  const content = {
    slides: [{
      section: 'KONTEKS',
      title: 'Tujuan pengujian',
      body: 'Data konsistensi membantu mengembangkan aplikasi penjinak ranjau.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'Data konsistensi membantu mengembangkan aplikasi penjinak ranjau.',
        sourceId: 'source-1',
        evidence: 'Laundry is difficult enough to test dexterity and safe enough that failure carries few consequences.'
      }]
    }]
  };
  const client = { chat: { completions: { create: async () => ({
    choices: [{ message: { content: JSON.stringify({ unsupported: [{ field: 'slide:0:body', reason: 'Evidence tidak menyebut aplikasi penjinak ranjau.' }] }) } }]
  }) } } };

  const errors = await auditClaimSemantics(client, content, 'Kenapa robot belajar melipat baju?');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /SEMANTIC_SUPPORT/);
  assert.match(errors[0], /penjinak ranjau/i);
});
