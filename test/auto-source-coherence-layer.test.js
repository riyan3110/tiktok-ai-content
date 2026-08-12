const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const layer = require('../src/services/autoSourceQualityLayer');

function factsFor(sourceId, label, count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    sourceId,
    evidence: `${label} fakta ${index + 1} menjelaskan kemampuan utama yang berbeda dan tetap relevan dengan topik.`
  }));
}

test('coherent plan gives each slide exactly one primary source and represents every selected source', () => {
  const sources = [{}, {}, {}];
  const facts = [
    ...factsFor('source-1', 'Satu', 8),
    ...factsFor('source-2', 'Dua', 6),
    ...factsFor('source-3', 'Tiga', 6)
  ];
  const plan = layer.buildCoherentPlan(sources, facts, 4);
  assert.equal(plan.length, 4);
  assert.deepEqual(new Set(plan.slice(0, 3).map(item => item.primarySourceId)), new Set(['source-1', 'source-2', 'source-3']));
  for (const item of plan) {
    assert.ok(item.evidence.length >= 1 && item.evidence.length <= 4);
    assert.ok(item.evidence.every(fact => fact.sourceId === item.primarySourceId));
  }
});

test('mixed sourceIds inside one slide are rejected with field-addressable coherence errors', () => {
  const content = {
    slides: [{
      title: 'Kemampuan Muse Code',
      body: 'Muse Code membantu berbagai pekerjaan software engineering melalui agen AI.',
      points: ['Menulis dan memperbaiki kode', 'Debugging dan pengujian', 'Memvalidasi hasil kode'],
      claims: [
        { field: 'slide:0:body', text: 'x', sourceId: 'source-1', evidence: 'e1' },
        { field: 'slide:0:point:0', text: 'x', sourceId: 'source-1', evidence: 'e2' },
        { field: 'slide:0:point:1', text: 'x', sourceId: 'source-2', evidence: 'e3' },
        { field: 'slide:0:point:2', text: 'x', sourceId: 'source-1', evidence: 'e4' }
      ]
    }]
  };
  const errors = layer.slideSourceCoherenceErrors(content);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /slide:0:point:1/);
  assert.match(errors[0], /satu slide harus satu sumber utama/i);
});

test('topic evidence gate rejects body or bullet evidence outside the scoped fact bank', () => {
  const facts = [
    { sourceId: 'source-1', evidence: 'Muse Code dapat menulis dan memperbaiki kode untuk tugas software engineering.' },
    { sourceId: 'source-1', evidence: 'Muse Code mendukung debugging dan pengujian kode.' }
  ];
  const content = {
    slides: [{
      body: 'Muse Code dapat menulis dan memperbaiki kode.',
      points: ['China meluncurkan AI energi bersih'],
      claims: [
        { field: 'slide:0:body', text: 'x', sourceId: 'source-1', evidence: facts[0].evidence },
        { field: 'slide:0:point:0', text: 'x', sourceId: 'source-1', evidence: 'China meluncurkan AI pertama untuk basis energi bersih berskala besar.' }
      ]
    }]
  };
  const errors = layer.topicEvidenceErrors(content, facts);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /slide:0:point:0/);
  assert.match(errors[0], /AUTO_SOURCE_CONTEXT/);
});

test('rich topic bank forces body plus exactly three bullets per slide', () => {
  const content = {
    slides: Array.from({ length: 4 }, () => ({ body: 'Body faktual yang cukup panjang untuk contoh pengujian ini.', points: ['Fakta satu', 'Fakta dua'] }))
  };
  const facts = [
    ...factsFor('source-1', 'Satu', 8),
    ...factsFor('source-2', 'Dua', 8)
  ];
  const errors = layer.forcedDensityErrors(content, facts);
  assert.equal(errors.length, 4);
  assert.ok(errors.every(error => /tepat 3 bullet/.test(error)));
});
