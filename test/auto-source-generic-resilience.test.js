const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/autoSourceFinalizer');

function slide(title, body, points = [], claims = []) {
  return { section: 'FAKTA UTAMA', title, body, points, claims };
}

test('richness is advisory and does not reject concise grounded slides based on source fact count', () => {
  const content = { slides: [
    slide('Konteks pertama', 'Platform menyediakan fitur generatif untuk membantu pengguna membuat konten.'),
    slide('Konteks kedua', 'Layanan menggabungkan beberapa fungsi dalam satu pengalaman penggunaan terpadu.'),
    slide('Konteks ketiga', 'Pengguna dapat mengakses fungsi utama melalui antarmuka yang tersedia.'),
    slide('Konteks keempat', 'Pembaruan menambahkan kemampuan baru tanpa mengubah tujuan utama layanan.')
  ] };
  const facts = Array.from({ length: 24 }, (_, index) => ({
    sourceId: 'source-1',
    evidence: `Fakta sumber ${index + 1} memiliki detail berbeda untuk pengujian.`
  }));
  assert.deepEqual(finalizer.richnessErrors(content, facts), []);
});

test('auto source coverage does not force every discovered source into final copy', () => {
  const body = 'Platform menyediakan fitur generatif untuk membantu pengguna membuat konten.';
  const evidence = 'Platform menyediakan fitur generatif untuk membantu pengguna membuat konten.';
  const content = { slides: [slide('Fitur utama platform', body, [], [
    { field: 'slide:0:body', text: body, sourceId: 'source-1', evidence }
  ])] };
  const sources = [
    { title: 'Sumber utama', text: evidence },
    { title: 'Sumber tambahan', text: 'Sumber kedua membahas konteks lain yang tidak perlu dipaksa masuk.' }
  ];
  assert.deepEqual(finalizer.autoSourceCoverageErrors(content, sources), []);
});

test('auto source coverage still rejects substantive copy without matching claim evidence', () => {
  const content = { slides: [slide(
    'Fitur utama platform',
    'Platform menyediakan fitur generatif untuk membantu pengguna membuat konten.'
  )] };
  const errors = finalizer.autoSourceCoverageErrors(content, [{
    title: 'Sumber utama',
    text: 'Platform menyediakan fitur generatif untuk membantu pengguna membuat konten.'
  }]);
  assert.ok(errors.some(error => /copy substantif tidak memiliki claim/i.test(error)));
});

test('unsupported semantic point is pruned deterministically while grounded body stays intact', async () => {
  const bodies = [
    'Platform menyediakan fitur generatif untuk membantu pengguna membuat konten.',
    'Layanan menggabungkan beberapa fungsi dalam satu pengalaman penggunaan terpadu.',
    'Pengguna dapat mengakses fungsi utama melalui antarmuka yang tersedia.',
    'Pembaruan menambahkan kemampuan baru tanpa mengubah tujuan utama layanan.'
  ];
  const evidence = [...bodies];
  const badPoint = 'Dipakai pada teks terpublikasi';
  const badEvidence = 'Platform supports general content creation workflows for users.';
  const source = { title: 'Platform generatif', text: [...evidence, badEvidence].join(' ') };
  const slides = bodies.map((body, index) => slide(
    `Konteks platform ${index + 1}`,
    body,
    index === 3 ? [badPoint] : [],
    [
      { field: `slide:${index}:body`, text: body, sourceId: 'source-1', evidence: body },
      ...(index === 3 ? [{ field: 'slide:3:point:0', text: badPoint, sourceId: 'source-1', evidence: badEvidence }] : [])
    ]
  ));
  const candidate = { slides };
  const openai = {
    chat: { completions: { create: async () => ({
      choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }]
    }) } }
  };

  const result = await finalizer.recoverSemanticPointFailures({
    openai,
    candidate,
    semanticErrors: [
      'SEMANTIC_SUPPORT: slide:3:point:0 tidak didukung evidence: Claim adds application not stated in evidence.'
    ],
    sources: [source],
    topic: 'Platform generatif',
    format: 'Fakta singkat',
    contentService: { validateContent: () => [] },
    facts: evidence.map(item => ({ sourceId: 'source-1', evidence: item }))
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.candidate.slides[3].points, []);
  assert.equal(result.candidate.slides[3].body, bodies[3]);
  assert.equal(result.candidate.slides[3].claims.some(claim => claim.field === 'slide:3:point:0'), false);
});
