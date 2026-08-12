const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const { compactOverlongPoints, richnessErrors } = require('../src/services/autoSourceFinalizer');

test('auto source compacts overlong factual bullets and keeps claim text aligned', () => {
  const original = 'Robot humanoid dapat berjalan stabil di permukaan yang tidak rata';
  const content = {
    slides: [{
      title: 'Robot humanoid bergerak mandiri',
      body: 'Robot humanoid memakai sistem kontrol untuk menjaga gerak tubuh tetap stabil saat berjalan.',
      points: [original],
      claims: [{ field: 'slide:0:point:0', text: original, sourceId: 'source-1', evidence: 'Humanoid robots can maintain balance while walking across uneven surfaces.' }]
    }]
  };
  compactOverlongPoints(content);
  assert.ok(content.slides[0].points[0].split(/\s+/).length <= 7);
  assert.equal(content.slides[0].claims[0].text, content.slides[0].points[0]);
});

test('auto source richness gate rejects thin slides and accepts fact-dense slides', () => {
  const facts = Array.from({ length: 20 }, (_, index) => ({ sourceId: 'source-1', evidence: `Evidence factual number ${index} with enough words for the source bank.` }));
  const thin = { slides: Array.from({ length: 4 }, () => ({ title: 'Judul fakta robot', body: 'Terlalu tipis.', points: [] })) };
  assert.ok(richnessErrors(thin, facts).length > 0);

  const dense = { slides: Array.from({ length: 4 }, (_, index) => ({
    title: `Fakta robot humanoid ${index + 1}`,
    body: 'Sistem robot humanoid menggabungkan sensor dan kontrol gerak untuk menjalankan fungsi fisik secara stabil.',
    points: ['Sensor membaca kondisi sekitar', 'Kontrol menjaga keseimbangan gerak', 'Aktuator menggerakkan bagian tubuh']
  })) };
  assert.deepEqual(richnessErrors(dense, facts), []);
});
