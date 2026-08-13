const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const routing = require('../src/services/autoSourceRoutingComposer');
const output = require('../src/services/autoSourceIndonesianOutput');

const askMapsPlan = {
  rawTopic: 'Google hadirkan Ask Maps berbasis Gemini di Indonesia',
  canonicalTopic: 'Google hadirkan Ask Maps berbasis Gemini di Indonesia',
  subjects: [],
  eventTerms: [],
  actionTerms: [],
  contextTerms: [],
  marketIntent: false
};

test('manual Auto Source removes visionary hype before facts reach the writer', () => {
  const source = {
    title: 'Google hadirkan Ask Maps berbasis Gemini',
    text: [
      'Ask Maps menggunakan Gemini untuk menjawab pertanyaan lanjutan tentang tempat dan perjalanan.',
      'Google secara fundamental mengubah pengalaman navigasi digital melalui pembaruan besar-besaran.'
    ].join(' ')
  };

  const cleaned = routing.keepOnlyReadableFacts(askMapsPlan.rawTopic, source, askMapsPlan);
  assert.match(cleaned.text, /Ask Maps menggunakan Gemini/i);
  assert.doesNotMatch(cleaned.text, /fundamental|pembaruan besar-besaran/i);
});

test('editorial hype is only retained when the user explicitly asks about that claim', () => {
  const hype = 'Google secara fundamental mengubah pengalaman navigasi digital melalui pembaruan besar-besaran.';
  assert.equal(routing.visibleEditorialHype(hype, askMapsPlan), true);
  assert.equal(routing.visibleEditorialHype(hype, {
    ...askMapsPlan,
    rawTopic: 'Benarkah Google secara fundamental mengubah pengalaman navigasi digital?',
    canonicalTopic: 'Google secara fundamental mengubah pengalaman navigasi digital'
  }), false);
});

test('visible repair catches rollout wording that turns future expansion into a completed launch', () => {
  const evidence = 'Ask Maps is expanding to more than 150 countries and territories, including Indonesia.';
  const overstated = 'Ask Maps sudah dirilis di lebih dari 150 negara, termasuk Indonesia.';
  const faithful = 'Ask Maps akan diperluas ke lebih dari 150 negara dan wilayah, termasuk Indonesia.';

  assert.equal(output.rolloutOverstatement(overstated, evidence), true);
  assert.equal(output.rolloutOverstatement(faithful, evidence), false);
});

test('visible repair catches thin source copy only when evidence supports more detail', () => {
  const longEvidence = 'Ask Maps menggunakan Gemini untuk memahami pertanyaan lanjutan yang kompleks dan memberi jawaban berdasarkan informasi tempat yang relevan.';
  assert.equal(output.bodyNeedsDensityRepair('Ask Maps menjawab pertanyaan kompleks.', { mainEvidence: longEvidence }), true);
  assert.equal(output.bodyNeedsDensityRepair(longEvidence, { mainEvidence: longEvidence }), false);
});

test('repair prompt preserves per-slide evidence and explicitly protects source certainty', () => {
  const packets = [{
    slideIndex: 0,
    section: 'PEMBUKA',
    sourceTitle: 'Ask Maps expands globally',
    publishedAt: '2026-08-13',
    mainEvidence: 'Ask Maps is expanding to more than 150 countries and territories.'
  }];
  const prompt = output.repairPrompt({
    topic: askMapsPlan.rawTopic,
    format: 'Fakta singkat',
    result: { slides: [{ title: 'Cakupan Global', body: 'Ask Maps sudah dirilis di 150 negara.', points: [] }] },
    packets
  });

  assert.match(prompt, /FAKTA SUMBER PER SLIDE/);
  assert.match(prompt, /expanding to more than 150 countries/);
  assert.match(prompt, /JANGAN mengubahnya menjadi telah\/sudah dirilis/i);
  assert.match(prompt, /Perbaiki HANYA copy yang masih kurang pas/i);
});
