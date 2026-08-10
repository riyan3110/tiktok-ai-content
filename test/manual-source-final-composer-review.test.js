const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  evidenceCandidates,
  extractManualFactBank,
  claimErrors,
  coverageErrors
} = require('../src/services/manualSourceComposer');

test('noise marker masuk tidak membuang kata termasuk pada fakta valid', () => {
  const text = [
    'Alpukat mengandung lemak tak jenuh tunggal yang mendukung aliran darah sehat, termasuk aliran darah menuju otak.',
    'Masuk untuk membaca artikel premium.',
    'Buah beri memiliki antosianin yang dibahas dalam artikel mengenai fungsi memori.'
  ].join('\n');
  const candidates = evidenceCandidates(text);
  assert.ok(candidates.some(value => /termasuk aliran darah menuju otak/i.test(value)));
  assert.equal(candidates.some(value => /^Masuk untuk membaca/i.test(value)), false);
});

test('claim tidak terikat field visual ditolak dan tidak menambah coverage', () => {
  const source = {
    title: '5 Daftar Buah yang Dapat Meningkatkan Daya Ingat',
    text: [
      'Apel memiliki antioksidan yang dibahas dalam konteks kesehatan otak dan fungsi memori.',
      'Alpukat memiliki lemak tak jenuh yang dibahas dalam konteks aliran darah menuju otak.',
      'Buah beri memiliki antosianin yang dibahas dalam konteks komunikasi antarsel di otak.',
      'Pisang memiliki vitamin B6 yang dibahas dalam proses pembentukan neurotransmiter tertentu.',
      'Jambu biji memiliki vitamin C yang berfungsi sebagai antioksidan dalam tubuh.'
    ].join('\n')
  };
  const bank = extractManualFactBank([source], 'Daya ingat');
  const visibleEvidence = bank[0].evidence;
  const slides = Array.from({ length: 4 }, (_, index) => ({
    section: `ITEM ${index + 1}`,
    title: `Buah ${index + 1}`,
    body: `Isi fakta yang terlihat pada slide ${index + 1} berasal dari evidence pertama dan sengaja dipakai untuk pengujian coverage.`,
    points: [],
    claims: [
      { field: `slide:${index}:title`, text: `Buah ${index + 1}`, sourceId: 'source-1', evidence: visibleEvidence },
      { field: `slide:${index}:body`, text: `Isi fakta yang terlihat pada slide ${index + 1} berasal dari evidence pertama dan sengaja dipakai untuk pengujian coverage.`, sourceId: 'source-1', evidence: visibleEvidence },
      { field: `slide:${index}:ghost`, text: `ghost ${index}`, sourceId: 'source-1', evidence: bank[(index + 1) % bank.length].evidence }
    ]
  }));
  const content = { slides };
  const claimValidation = claimErrors(content, [source], 'Listicle', bank);
  assert.ok(claimValidation.some(error => /claim tidak terikat ke field yang tampil/i.test(error)));
  const coverage = coverageErrors(content, bank);
  assert.ok(coverage.some(error => /hanya 1 fakta canonical/i.test(error)));
});
