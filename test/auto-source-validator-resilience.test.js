const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/autoSourceFinalizer');

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
