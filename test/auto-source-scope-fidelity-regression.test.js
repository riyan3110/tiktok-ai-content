const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const output = require('../src/services/autoSourceIndonesianOutput');

function packet(mainEvidence) {
  return {
    topic: 'Google hadirkan Ask Maps berbasis Gemini di Indonesia',
    mainEvidence
  };
}

test('does not widen an Indonesia rollout into all users or all Ask Maps locations', () => {
  const evidence = 'Ask Maps is expanding to Indonesia and more countries over time.';
  assert.equal(output.scopeOverstatement(
    'Google resmi meluncurkan Ask Maps untuk semua pengguna Google Maps di Indonesia.',
    evidence
  ), true);
  assert.equal(output.scopeOverstatement(
    'Ask Maps diperluas ke Indonesia sebagai bagian dari perluasan ke lebih banyak negara.',
    evidence
  ), false);
});

test('does not turn an ongoing rollout into a completed official launch', () => {
  const evidence = 'Ask Maps is rolling out now and expanding to Indonesia.';
  assert.equal(output.rolloutOverstatement(
    'Google secara resmi meluncurkan Ask Maps di Indonesia.',
    evidence
  ), true);
});

test('does not splice real-time transit into Gmail Personal Intelligence evidence', () => {
  const gmail = packet('Personal Intelligence can connect Ask Maps to Gmail to start, with Calendar support coming soon.');
  assert.equal(output.criticalAngleMismatch(
    'Ask Maps terhubung ke Gmail melalui Personal Intelligence, dengan dukungan Calendar menyusul.',
    gmail
  ), false);
  assert.equal(output.criticalAngleMismatch(
    'Ask Maps menambahkan informasi waktu nyata dan terhubung ke Gmail melalui Personal Intelligence.',
    gmail
  ), true);
});

test('keeps real-time transit isolated when that is the selected evidence', () => {
  const transit = packet('Real-time transit information has been added to Ask Maps for bus, train, subway, and ferry delays.');
  assert.equal(output.criticalAngleMismatch(
    'Ask Maps kini menampilkan informasi transit waktu nyata untuk keterlambatan bus, kereta, subway, dan feri.',
    transit
  ), false);
  assert.equal(output.criticalAngleMismatch(
    'Ask Maps memakai Gmail untuk preferensi dan menampilkan informasi transit waktu nyata.',
    transit
  ), true);
});

test('repair prompt explicitly preserves scope and keeps capabilities on their own evidence', () => {
  const prompt = output.repairPrompt({
    topic: 'Google hadirkan Ask Maps berbasis Gemini di Indonesia',
    format: 'Fakta singkat',
    result: { slides: [] },
    packets: []
  });
  assert.match(prompt, /Cakupan WAJIB sama dengan mainEvidence/);
  assert.match(prompt, /Jangan menggabungkan dua kemampuan dari fakta berbeda/);
  assert.match(prompt, /real-time transit tidak boleh dimasukkan ke body Gmail\/Personal Intelligence/);
});
