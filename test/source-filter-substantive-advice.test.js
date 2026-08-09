const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  requiresSourceEvidence,
  validateVerifiedContent,
  generateFilteredContent
} = require('../src/services/sourceFilter');

const contentService = { validateContent() { return []; } };

test('tips konkret dalam source mode tetap wajib evidence walau berbentuk kalimat perintah', () => {
  assert.equal(requiresSourceEvidence('Koreksi warna batch', 'SOLUSI', 'point', 2, 4), true);
  assert.equal(requiresSourceEvidence('Tambahkan transisi halus', 'SOLUSI', 'point', 2, 4), true);
  assert.equal(requiresSourceEvidence('Periksa audio sinkronisasi', 'SOLUSI', 'point', 2, 4), true);
  assert.equal(requiresSourceEvidence('Baca sumber lengkap sebelum menyimpulkan', 'PENUTUP', 'body', 3, 4), false);
});

test('solusi konkret tanpa evidence ditolak walau artikel sumber valid', () => {
  const evidence = 'Sora 2 Enhancer refines light, tone, and exposure after generation.';
  const slides = [
    { section: 'MASALAH', title: 'Kenapa hasil video AI berubah?', body: 'Baca sumber lengkap untuk melihat masalahnya.', points: [], claims: [] },
    {
      section: 'SOLUSI',
      title: 'Perbaikan pencahayaan setelah generasi',
      body: 'Sora 2 Enhancer menyempurnakan cahaya, tone, dan exposure setelah generasi.',
      points: [],
      claims: [
        { field: 'slide:1:title', text: 'Perbaikan pencahayaan setelah generasi', sourceId: 'source-1', evidence },
        { field: 'slide:1:body', text: 'Sora 2 Enhancer menyempurnakan cahaya, tone, dan exposure setelah generasi.', sourceId: 'source-1', evidence }
      ]
    },
    {
      section: 'SOLUSI',
      title: 'Optimasi akhir sebelum publishing',
      body: '',
      points: ['Koreksi warna batch', 'Tambahkan transisi halus', 'Periksa audio sinkronisasi'],
      claims: []
    },
    { section: 'PENUTUP', title: 'Baca konteks sumber', body: 'Cek sumber lengkap sebelum mencoba.', points: [], claims: [] }
  ];
  const checked = validateVerifiedContent({ slides }, { slides }, {
    contentService,
    format: 'Masalah dan solusi',
    manualTopic: '',
    sources: [{ text: evidence }]
  });
  assert.ok(checked.errors.some(error => /slide:2:point:0.*tidak memiliki evidence/i.test(error)));
  assert.ok(checked.errors.some(error => /slide:2:point:1.*tidak memiliki evidence/i.test(error)));
  assert.ok(checked.errors.some(error => /slide:2:point:2.*tidak memiliki evidence/i.test(error)));
});

test('source filter menolak base tiga slide sebelum hasil bisa dirender', async () => {
  const content = {
    async generateContent() {
      return {
        topic: 'Topik', hook: 'Hook', body: 'Isi', caption: 'Caption', cta: 'CTA', hashtags: [],
        focus: { masalah: 'm', penyebab: 'p', solusi: 's', hasil: 'h' },
        trendKeywordsUsed: [], content_angle: 'angle', primary_tool: 'tanpa tool', hook_pattern: 'langsung',
        slides: [
          { section: 'MASALAH', title: 'Satu', body: 'Isi satu.', points: [] },
          { section: 'SOLUSI', title: 'Dua', body: 'Isi dua.', points: [] },
          { section: 'SOLUSI', title: 'Tiga', body: 'Isi tiga.', points: [] }
        ]
      };
    },
    validateContent() { return []; }
  };
  await assert.rejects(() => generateFilteredContent({
    content,
    options: { topicSource: 'manual', requestedTopic: 'Topik', contentFormat: 'Masalah dan solusi' },
    sources: [{ title: 'Topik', text: 'Artikel sumber memiliki fakta yang cukup untuk pengujian sistem.' }],
    client: { chat: { completions: { async create() { throw new Error('verifier tidak boleh dipanggil'); } } } }
  }), /wajib 4–5 slide/i);
});
