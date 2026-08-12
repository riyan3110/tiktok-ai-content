const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/autoSourceFinalizer');
const sourceFilter = require('../src/services/sourceFilter');

test('nearby source sentence is added to evidence before strict numeric verification', () => {
  const sourceText = 'OpenAI memperkenalkan GPT-5.6-Cyber untuk program Daybreak. OpenAI memperluas program keamanan siber Daybreak dengan dua tingkat akses, yaitu Blue dan Red.';
  const content = {
    slides: [{
      title: 'Daybreak punya dua tingkat akses',
      body: 'OpenAI memperkenalkan GPT-5.6-Cyber lewat program Daybreak dengan akses Blue dan Red.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'OpenAI memperkenalkan GPT-5.6-Cyber lewat program Daybreak dengan akses Blue dan Red.',
        sourceId: 'source-1',
        evidence: 'OpenAI memperluas program keamanan siber Daybreak dengan dua tingkat akses, yaitu Blue dan Red.'
      }]
    }]
  };
  finalizer.repairKnownNumericShorthand(content, [{ title: 'Daybreak', text: sourceText }]);
  assert.match(content.slides[0].claims[0].evidence, /GPT-5\.6-Cyber/);
  assert.match(content.slides[0].claims[0].evidence, /Blue dan Red/);
});

test('separated product model number in source title survives strict source verification', () => {
  const body = 'iQOO Neo 11 membawa layar AMOLED generasi baru dan chipset flagship untuk kelasnya.';
  const evidence = 'Ponsel ini membawa layar AMOLED generasi baru dan chipset flagship untuk kelasnya.';
  const sources = [{
    title: 'iQOO Neo 11 resmi meluncur',
    text: evidence
  }];
  const content = {
    slides: [{
      section: 'FAKTA UTAMA',
      title: 'Ponsel flagship terbaru iQOO',
      body,
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: body,
        sourceId: 'source-1',
        evidence
      }]
    }]
  };

  assert.deepEqual(finalizer.numericGroundingErrors(content, sources), []);
  finalizer.repairKnownNumericShorthand(content, sources);
  assert.match(content.slides[0].claims[0].evidence, /iQOO Neo 11/i);
  assert.match(sources[0].text, /^iQOO Neo 11/i);

  const checked = sourceFilter.validateVerifiedContent(content, { slides: content.slides }, {
    contentService: { validateContent: () => [] },
    format: 'Fakta singkat',
    manualTopic: 'iQOO Neo 11',
    sources,
    autoSourceTopic: true
  });

  assert.equal(checked.errors.some(error => /Angka pada claim tidak didukung evidence/i.test(error)), false);
  assert.equal(checked.errors.some(error => /Evidence tidak ditemukan/i.test(error)), false);
  assert.equal(checked.errors.some(error => /fakta terverifikasi dari sumber/i.test(error)), false);
});
