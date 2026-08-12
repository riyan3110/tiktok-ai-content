const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const sourceFilter = require('../src/services/sourceFilter');
const finalizer = require('../src/services/sourceUrlFinalizer');

function contentFixture() {
  return {
    topic: 'Muse Code',
    slides: [{
      section: 'PEMBUKA',
      title: 'Pembuka',
      body: 'Muse Code adalah agen AI coding baru dari Meta untuk membantu pengembangan software.',
      points: [
        'Dikembangkan langsung oleh Meta',
        'Menangani tugas software engineering',
        'Mendukung pekerjaan coding kompleks'
      ],
      claims: [
        {
          field: 'slide:0:title',
          text: 'Pembuka',
          sourceId: 'source-1',
          evidence: 'Muse Code adalah agen AI coding baru dari Meta untuk membantu pengembangan software.'
        },
        {
          field: 'slide:0:body',
          text: 'Muse Code adalah agen AI coding baru dari Meta untuk membantu pengembangan software.',
          sourceId: 'source-1',
          evidence: 'Muse Code adalah agen AI coding baru dari Meta untuk membantu pengembangan software.'
        }
      ]
    }]
  };
}

test('semantic error pada title saja tidak menjadi blocker Pakai URL', () => {
  const errors = [
    'SEMANTIC_SUPPORT: slide:0:title tidak didukung evidence: Evidence does not assert the title Pembuka.'
  ];
  assert.deepEqual(finalizer.blockingSemanticErrors(errors), []);
});

test('semantic error body tetap menjadi blocker walau title juga error', () => {
  const errors = [
    'SEMANTIC_SUPPORT: slide:0:title tidak didukung evidence: title terlalu luas.',
    'SEMANTIC_SUPPORT: slide:0:body tidak didukung evidence: body menambah manfaat.'
  ];
  assert.deepEqual(finalizer.blockingSemanticErrors(errors), [errors[1]]);
});

test('title semantic yang gagal direpair dari body grounded tanpa mengubah body dan bullet', () => {
  const original = contentFixture();
  const repaired = finalizer.repairSemanticTitleErrors(original, [
    'SEMANTIC_SUPPORT: slide:0:title tidak didukung evidence: Evidence does not assert the title Pembuka.'
  ]);
  assert.equal(repaired.changed, true);
  assert.notEqual(repaired.content.slides[0].title, 'Pembuka');
  assert.notEqual(repaired.content.slides[0].title.toUpperCase(), 'PEMBUKA');
  assert.match(repaired.content.slides[0].title, /Muse Code/i);
  assert.equal(repaired.content.slides[0].body, original.slides[0].body);
  assert.deepEqual(repaired.content.slides[0].points, original.slides[0].points);
  assert.equal(repaired.content.slides[0].claims.some(claim => claim.field === 'slide:0:title'), false);
  assert.equal(repaired.content.slides[0].claims.some(claim => claim.field === 'slide:0:body'), true);
});

test('audit URL mengembalikan konten ketika auditor hanya menolak title', async t => {
  const originalAudit = sourceFilter.auditClaimSemantics;
  sourceFilter.auditClaimSemantics = async () => [
    'SEMANTIC_SUPPORT: slide:0:title tidak didukung evidence: evidence tidak menyatakan judul Pembuka.'
  ];
  t.after(() => { sourceFilter.auditClaimSemantics = originalAudit; });

  const result = await finalizer.auditUrlSemantics({}, contentFixture(), 'Muse Code', 'Fakta singkat');
  assert.deepEqual(result.errors, []);
  assert.equal(result.titleErrors.length, 1);
  assert.notEqual(result.content.slides[0].title, 'Pembuka');
  assert.equal(result.content.slides[0].body, contentFixture().slides[0].body);
});

test('prompt Pakai URL melarang nama section sebagai title dan mempertahankan density', () => {
  const sources = [{
    url: 'https://example.test/muse',
    title: 'Muse Code',
    text: Array.from({ length: 18 }, (_, index) => `Muse Code memiliki fakta relevan nomor ${index + 1} yang menjelaskan kemampuan pengembangan software.`).join(' ')
  }];
  const facts = Array.from({ length: 16 }, (_, index) => ({
    sourceId: 'source-1',
    evidence: `Muse Code memiliki fakta relevan nomor ${index + 1} yang menjelaskan kemampuan pengembangan software.`
  }));
  const prompt = finalizer.finalizerPrompt({
    generated: { slides: ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'].map(section => ({ section })) },
    sources,
    facts,
    format: 'Fakta singkat',
    topic: 'Muse Code',
    errors: []
  });
  assert.match(prompt, /Judul DILARANG hanya berupa nama section/i);
  assert.match(prompt, /body \+ 3 bullet/i);
  assert.match(prompt, /SETIAP sourceId/i);
});
