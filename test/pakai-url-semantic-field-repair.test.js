const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const repair = require('../src/services/sourceUrlSemanticRepair');
const finalizer = require('../src/services/sourceUrlFinalizer');

function contentFixture() {
  return {
    topic: 'Topik uji',
    slides: [{
      section: 'PEMBUKA',
      title: 'Fitur Baru untuk Pengguna',
      body: 'Fitur ini hadir agar pengguna lebih mudah mengelola pekerjaan sehari-hari.',
      points: ['Tersedia untuk pengguna beta', 'Diuji pada aplikasi utama', 'Peluncuran dilakukan bertahap'],
      claims: [
        {
          field: 'slide:0:body',
          text: 'Fitur ini hadir agar pengguna lebih mudah mengelola pekerjaan sehari-hari.',
          sourceId: 'source-1',
          evidence: 'The feature is available to users in the beta release.'
        },
        {
          field: 'slide:0:point:0',
          text: 'Tersedia untuk pengguna beta',
          sourceId: 'source-1',
          evidence: 'The feature is available to users in the beta release.'
        },
        {
          field: 'slide:0:point:1',
          text: 'Diuji pada aplikasi utama',
          sourceId: 'source-1',
          evidence: 'Testing is taking place in the main application.'
        },
        {
          field: 'slide:0:point:2',
          text: 'Peluncuran dilakukan bertahap',
          sourceId: 'source-1',
          evidence: 'The rollout is happening gradually.'
        }
      ]
    }]
  };
}

test('semantic target repair hanya mengambil body/point yang ditolak, bukan title', () => {
  const content = contentFixture();
  const errors = [
    "SEMANTIC_SUPPORT: slide:0:title tidak didukung evidence: title terlalu luas",
    "SEMANTIC_SUPPORT: slide:0:body tidak didukung evidence: claim adds purpose 'agar lebih mudah' not present in evidence",
    'SEMANTIC_SUPPORT: slide:0:point:1 tidak didukung evidence: claim terlalu kuat'
  ];
  const targets = repair.semanticTargetFields(content, errors);
  assert.deepEqual(targets.map(item => item.field), ['slide:0:body', 'slide:0:point:1']);
  assert.equal(targets[0].sourceId, 'source-1');
  assert.equal(targets[0].evidence, 'The feature is available to users in the beta release.');
});

test('applySemanticRepairs mengubah hanya field target dan mempertahankan evidence/sourceId', () => {
  const content = contentFixture();
  const beforePoint0 = content.slides[0].points[0];
  const beforePoint2 = content.slides[0].points[2];
  const applied = repair.applySemanticRepairs(content, [
    { field: 'slide:0:body', text: 'Fitur ini tersedia untuk pengguna dalam versi beta yang sedang dirilis.' },
    { field: 'slide:0:point:1', text: 'Pengujian berlangsung di aplikasi utama' }
  ]);
  assert.equal(applied.changed, true);
  assert.equal(applied.content.slides[0].body, 'Fitur ini tersedia untuk pengguna dalam versi beta yang sedang dirilis.');
  assert.equal(applied.content.slides[0].points[1], 'Pengujian berlangsung di aplikasi utama');
  assert.equal(applied.content.slides[0].points[0], beforePoint0);
  assert.equal(applied.content.slides[0].points[2], beforePoint2);
  const bodyClaim = applied.content.slides[0].claims.find(item => item.field === 'slide:0:body');
  assert.equal(bodyClaim.sourceId, 'source-1');
  assert.equal(bodyClaim.evidence, 'The feature is available to users in the beta release.');
  assert.equal(bodyClaim.text, applied.content.slides[0].body);
});

test('targeted semantic repair mempertahankan slide padat dan tidak full rebuild', async () => {
  const content = contentFixture();
  const errors = ["SEMANTIC_SUPPORT: slide:0:body tidak didukung evidence: claim adds purpose 'agar lebih mudah' not present in evidence"];
  let calls = 0;
  const openai = {
    chat: { completions: { create: async () => {
      calls += 1;
      return { choices: [{ message: { content: JSON.stringify({
        repairs: [{ field: 'slide:0:body', text: 'Fitur ini tersedia untuk pengguna dalam versi beta yang sedang dirilis.' }]
      }) } }] };
    } } }
  };

  const result = await repair.recoverSemanticFailures({
    openai,
    model: 'test-model',
    content,
    errors,
    topic: 'Topik uji',
    format: 'Fakta singkat',
    validate: candidate => {
      assert.equal(candidate.slides[0].points.length, 3);
      assert.equal(candidate.slides[0].title, 'Fitur Baru untuk Pengguna');
      return { content: candidate, errors: [] };
    },
    audit: async candidate => ({ content: candidate, errors: [] })
  });

  assert.equal(calls, 1);
  assert.equal(result.changed, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.content.slides[0].points.length, 3);
  assert.match(result.content.slides[0].body, /tersedia untuk pengguna/i);
});

test('repair prompt melarang inferensi tujuan/manfaat/strategi dan tetap menjaga density', () => {
  const prompt = repair.semanticRepairPrompt([
    {
      field: 'slide:0:body',
      text: 'Claim lama',
      sourceId: 'source-1',
      evidence: 'Evidence source',
      reason: 'menambahkan tujuan'
    }
  ], 'Topik uji', 'Fakta singkat');
  assert.match(prompt, /tujuan, sebab-akibat, manfaat, aplikasi, risiko, strategi/i);
  assert.match(prompt, /body: 10–20 kata/i);
  assert.match(prompt, /point: 3–7 kata/i);
  assert.match(prompt, /HANYA evidence milik field itu sendiri/i);
});

test('finalizer Pakai URL tetap mewajibkan semua source dan body + bullet padat', () => {
  const facts = Array.from({ length: 16 }, (_, index) => ({
    sourceId: `source-${(index % 2) + 1}`,
    evidence: `Fakta sumber ${index + 1} memiliki konteks berbeda yang relevan dengan topik utama.`
  }));
  const prompt = finalizer.finalizerPrompt({
    generated: { slides: Array.from({ length: 4 }, (_, index) => ({ section: index === 0 ? 'PEMBUKA' : index === 3 ? 'KESIMPULAN' : 'PENJELASAN' })) },
    sources: [
      { url: 'https://one.test', title: 'Satu', text: facts.filter(item => item.sourceId === 'source-1').map(item => item.evidence).join(' ') },
      { url: 'https://two.test', title: 'Dua', text: facts.filter(item => item.sourceId === 'source-2').map(item => item.evidence).join(' ') }
    ],
    facts,
    format: 'Fakta singkat',
    topic: 'Topik uji',
    errors: []
  });
  assert.match(prompt, /SETIAP sourceId yang tercantum WAJIB/i);
  assert.match(prompt, /3 bullet fakta berbeda/i);
  assert.match(prompt, /BODY 10–20 kata/i);
  assert.match(prompt, /DILARANG menambahkan tujuan, sebab-akibat, manfaat/i);
});