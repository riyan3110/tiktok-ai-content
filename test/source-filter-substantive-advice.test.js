const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  requiresSourceEvidence,
  validateVerifiedContent,
  auditClaimSemantics
} = require('../src/services/sourceFilter');

const contentService = { validateContent() { return []; } };

test('tips konkret pada Masalah dan solusi wajib evidence walau berbentuk kalimat perintah', () => {
  const format = 'Masalah dan solusi';
  assert.equal(requiresSourceEvidence('Koreksi warna batch', 'SOLUSI', 'point', 2, 4, format), true);
  assert.equal(requiresSourceEvidence('Tambahkan transisi halus', 'SOLUSI', 'point', 2, 4, format), true);
  assert.equal(requiresSourceEvidence('Periksa audio sinkronisasi', 'SOLUSI', 'point', 2, 4, format), true);
  assert.equal(requiresSourceEvidence('Baca sumber lengkap sebelum menyimpulkan', 'PENUTUP', 'body', 3, 4, format), false);
});

test('solusi konkret tanpa evidence ditolak walau artikel sumber valid', () => {
  const evidence = 'Sora 2 Enhancer refines light, tone, and exposure after generation.';
  const slides = [
    { section: 'MASALAH', title: 'Kenapa hasil video AI berubah?', body: 'Baca sumber lengkap untuk melihat masalahnya.', points: [], claims: [] },
    {
      section: 'SOLUSI',
      title: 'Perbaikan pencahayaan setelah generasi',
      body: 'Sora 2 Enhancer menyempurnakan cahaya, tone, dan exposure setelah generasi.',
      points: [],
      claims: [
        { field: 'slide:1:title', text: 'Perbaikan pencahayaan setelah generasi', sourceId: 'source-1', evidence },
        { field: 'slide:1:body', text: 'Sora 2 Enhancer menyempurnakan cahaya, tone, dan exposure setelah generasi.', sourceId: 'source-1', evidence }
      ]
    },
    {
      section: 'SOLUSI',
      title: 'Optimasi akhir sebelum publishing',
      body: '',
      points: ['Koreksi warna batch', 'Tambahkan transisi halus', 'Periksa audio sinkronisasi'],
      claims: []
    },
    { section: 'PENUTUP', title: 'Baca konteks sumber', body: 'Cek sumber lengkap sebelum mencoba.', points: [], claims: [] }
  ];
  const checked = validateVerifiedContent({ slides }, { slides }, {
    contentService,
    format: 'Masalah dan solusi',
    manualTopic: '',
    sources: [{ text: evidence }]
  });
  assert.ok(checked.errors.some(error => /slide:2:point:0.*tidak memiliki evidence/i.test(error)));
  assert.ok(checked.errors.some(error => /slide:2:point:1.*tidak memiliki evidence/i.test(error)));
  assert.ok(checked.errors.some(error => /slide:2:point:2.*tidak memiliki evidence/i.test(error)));
});

test('audit Masalah dan solusi menerima konteks slide dan menolak solusi yang tidak menjawab masalah', async () => {
  const content = { slides: [
    {
      section: 'MASALAH',
      title: 'Iklan video AI terasa generik',
      body: 'Hook yang lemah membuat pembuka kurang menarik.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'Hook yang lemah membuat pembuka kurang menarik.',
        sourceId: 'source-1',
        evidence: 'Weak hooks can make AI video ads feel generic.'
      }]
    },
    {
      section: 'SOLUSI',
      title: 'Jaga konsistensi merek',
      body: 'Gunakan orang nyata agar wajah AI tidak mendominasi.',
      points: [],
      claims: [{
        field: 'slide:1:body',
        text: 'Gunakan orang nyata agar wajah AI tidak mendominasi.',
        sourceId: 'source-1',
        evidence: 'Use real people and maintain brand consistency instead of relying on AI faces.'
      }]
    }
  ] };
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    assert.match(prompt, /SLIDES:.*Hook yang lemah.*Jaga konsistensi merek/s);
    assert.match(prompt, /Setiap SOLUSI\/tips harus langsung menjawab MASALAH/);
    return { choices: [{ message: { content: JSON.stringify({
      unsupported: [{ field: 'slide:1:body', reason: 'Solusi membahas merek dan wajah AI, bukan hook yang lemah.' }]
    }) } }] };
  } } } };

  const errors = await auditClaimSemantics(client, content, 'Kualitas iklan video AI', 'Masalah dan solusi');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /bukan hook yang lemah/i);
});

test('audit hasil menjaga modalitas kemungkinan dari evidence', async () => {
  const makeContent = body => ({ slides: [{
    section: 'HASIL', title: 'Dampak pada performa', body, points: [],
    claims: [{ field: 'slide:0:body', text: body, sourceId: 'source-1', evidence: 'This approach can help improve ad performance.' }]
  }] });
  const prompts = [];
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    prompts.push(prompt);
    const certain = prompt.includes('Performa iklan meningkat');
    return { choices: [{ message: { content: JSON.stringify({ unsupported: certain
      ? [{ field: 'slide:0:body', reason: 'Claim pasti melampaui kemungkinan pada evidence.' }]
      : [] }) } }] };
  } } } };

  const rejected = await auditClaimSemantics(client, makeContent('Performa iklan meningkat'), 'Performa iklan', 'Masalah dan solusi');
  const accepted = await auditClaimSemantics(client, makeContent('Dapat membantu meningkatkan performa iklan'), 'Performa iklan', 'Masalah dan solusi');
  assert.equal(rejected.length, 1);
  assert.deepEqual(accepted, []);
  assert.ok(prompts.every(prompt => /Jangan mengubah kemungkinan menjadi kepastian/.test(prompt)));
});

test('audit coherence meneruskan error title solusi structural tanpa claim', async () => {
  const content = { slides: [
    {
      section: 'MASALAH', title: 'Hook iklan terasa lemah', body: 'Pembuka video AI terasa generik.', points: [],
      claims: [{ field: 'slide:0:body', text: 'Pembuka video AI terasa generik.', sourceId: 'source-1', evidence: 'Weak hooks can make AI video ads feel generic.' }]
    },
    {
      section: 'SOLUSI', title: 'Pertahankan konsistensi merek', body: 'Perkuat hook pada awal video.', points: [],
      claims: [{ field: 'slide:1:body', text: 'Perkuat hook pada awal video.', sourceId: 'source-1', evidence: 'Strengthen the hook at the start of the video.' }]
    }
  ] };
  const client = { chat: { completions: { async create() {
    return { choices: [{ message: { content: JSON.stringify({ unsupported: [{
      field: 'slide:1:title',
      reason: 'Title membahas konsistensi merek, sedangkan isi slide membahas hook.'
    }] }) } }] };
  } } } };

  const errors = await auditClaimSemantics(client, content, 'Kualitas iklan video AI', 'Masalah dan solusi');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /SEMANTIC_SUPPORT: slide:1:title/);
});
