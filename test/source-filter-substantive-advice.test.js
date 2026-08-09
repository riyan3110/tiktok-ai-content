const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  requiresSourceEvidence,
  validateVerifiedContent
} = require('../src/services/sourceFilter');

const contentService = { validateContent() { return []; } };

test('tips konkret pada Masalah dan solusi wajib evidence walau berbentuk kalimat perintah', () => {
  const format = 'Masalah dan solusi';
  assert.equal(requiresSourceEvidence('Koreksi warna batch', 'SOLUSI', 'point', 2, 4, format), true);
  assert.equal(requiresSourceEvidence('Tambahkan transisi halus', 'SOLUSI', 'point', 2, 4, format), true);
  assert.equal(requiresSourceEvidence('Periksa audio sinkronisasi', 'SOLUSI', 'point', 2, 4, format), true);
  assert.equal(requiresSourceEvidence('Baca sumber lengkap sebelum menyimpulkan', 'PENUTUP', 'body', 3, 4, format), false);
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
