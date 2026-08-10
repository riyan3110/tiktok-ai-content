const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateFilteredContent,
  sourceBackedDuplicateErrors,
  recoveryFieldKeys,
  MAX_VERIFY_ATTEMPTS
} = require('../src/services/sourceFilter');

test('duplicate source-backed ditargetkan ke field yang lebih akhir', () => {
  const errors = sourceBackedDuplicateErrors([
    {
      title: 'China Dominasi Papan Atas',
      body: 'Pengembang China mendominasi papan atas.',
      points: ['Pengembang China mendominasi papan atas', 'Pengembang China mendominasi papan atas']
    },
    {
      title: 'Metode Penilaian Model',
      body: 'Peringkat disusun melalui voting blind.',
      points: ['Sampel berasal dari penilaian pengguna', 'Penilaian pengguna menjadi sampel']
    },
    {
      title: 'Google Tetap Memimpin',
      body: 'Gemini mencatat skor Elo 1.243.',
      points: ['Hampir 12.000 sampel penilaian']
    }
  ]);

  assert.deepEqual(errors, [
    'slide:0:body: copy mengulang title.',
    'slide:0:point:0: copy mengulang title.',
    'slide:0:point:1: copy mengulang title.',
    'slide:1:point:1: copy mengulang point lain.'
  ]);
  assert.deepEqual([...recoveryFieldKeys(errors)], [
    'slide:0:body', 'slide:0:point:0', 'slide:0:point:1', 'slide:1:point:1'
  ]);
});

test('duplicate body menjalani targeted recovery, field lain terkunci, lalu semantic audit', async () => {
  const factA = 'Pengembang China mendominasi papan atas model video AI.';
  const factB = 'Delapan dari sepuluh model teratas berasal dari pengembang China.';
  const title = 'China Dominasi Papan Atas';
  const duplicateBody = 'Pengembang China mendominasi papan atas.';
  const repairedBody = 'Delapan dari sepuluh model teratas berasal dari pengembang China.';
  const base = {
    focus: {}, topic: 'Model video AI', hook: title, body: duplicateBody, caption: duplicateBody,
    hashtags: [], cta: title, trendKeywordsUsed: [], content_angle: 'peringkat', primary_tool: 'tanpa tool',
    hook_pattern: 'langsung', slides: [{ section: 'ITEM 1', title, body: duplicateBody, points: [] }]
  };
  const duplicate = { slides: [{
    ...base.slides[0], claims: [
      { field: 'slide:0:title', text: title, sourceId: 'source-1', evidence: factA },
      { field: 'slide:0:body', text: duplicateBody, sourceId: 'source-1', evidence: factA }
    ]
  }] };
  let verifierCalls = 0;
  let recoveryCalls = 0;
  let auditCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      auditCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    if (/FINAL SAFE RECOVERY/i.test(prompt)) {
      recoveryCalls += 1;
      assert.match(prompt, /copy mengulang title\/body\/point/);
      assert.match(prompt, /fakta relevan lain dari FACT_BANK yang belum dipakai/);
      return { choices: [{ message: { content: JSON.stringify({ slides: [{
        section: 'ITEM 1', title: 'Title ini harus diabaikan', body: repairedBody, points: [],
        claims: [{ field: 'slide:0:body', text: repairedBody, sourceId: 'source-1', evidence: factB }]
      }] }) } }] };
    }
    verifierCalls += 1;
    return { choices: [{ message: { content: JSON.stringify(duplicate) } }] };
  } } } };

  const result = await generateFilteredContent({
    content: { async generateContent() { return base; }, validateContent() { return []; } },
    options: { topicSource: 'ai', useSources: true, requestedTopic: '', contentFormat: 'Listicle' },
    sources: [{ url: 'https://example.test/ranking', text: `${factA} ${factB}` }],
    client
  });

  assert.equal(verifierCalls, MAX_VERIFY_ATTEMPTS);
  assert.equal(recoveryCalls, 1);
  assert.equal(result.slides[0].title, title, 'title non-target tetap terkunci');
  assert.equal(result.slides[0].body, repairedBody);
  assert.equal(result.slides[0].claims.find(claim => claim.field === 'slide:0:body').evidence, factB);
  assert.equal(auditCalls, 1, 'copy hasil recovery wajib melewati semantic audit');
});

test('source filter tidak menghidupkan lagi duplicate-copy hard gate sebelum verifikasi fakta', async () => {
  let baseOptions;
  let validationOptions;

  const base = {
    focus: { masalah: 'Konteks perlu dipahami', penyebab: 'Informasi tersebar', solusi: 'Periksa sumber', hasil: 'Pemahaman lebih jelas' },
    topic: 'Topik uji sumber',
    hook: 'Pertanyaan yang perlu dilihat',
    body: 'Cek konteks lengkap sebelum menyimpulkan.',
    caption: 'Cek konteks lengkap sebelum menyimpulkan.',
    hashtags: [],
    cta: 'Periksa konteks lengkapnya',
    trendKeywordsUsed: [],
    content_angle: 'angle uji sumber',
    primary_tool: 'tanpa tool',
    hook_pattern: 'pertanyaan',
    slides: [{
      section: 'PEMBUKA',
      title: 'Pertanyaan yang perlu dilihat',
      body: 'Cek konteks lengkap sebelum menyimpulkan.',
      points: []
    }]
  };

  const content = {
    generateContent: async (_previousTopics, options) => {
      baseOptions = options;
      return base;
    },
    validateContent: (_value, options) => {
      validationOptions = options;
      return options.validateCopy ? ['duplicate-copy hard gate aktif'] : [];
    }
  };

  const candidate = {
    slides: [{
      section: 'PEMBUKA',
      title: 'Pertanyaan yang perlu dilihat',
      body: 'Cek konteks lengkap sebelum menyimpulkan.',
      points: [],
      claims: []
    }]
  };

  const client = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: JSON.stringify(candidate) } }] })
      }
    }
  };

  const result = await generateFilteredContent({
    content,
    previousTopics: [],
    options: {
      topicSource: 'manual',
      requestedTopic: 'Topik uji sumber',
      contentFormat: 'Listicle',
      useSources: true
    },
    sources: [{
      url: 'https://example.test/article',
      text: 'Artikel sumber menjelaskan konteks yang cukup untuk proses verifikasi fakta.'
    }],
    client
  });

  assert.equal(baseOptions.useSources, false);
  assert.equal(baseOptions.skipCopyValidation, true);
  assert.equal(validationOptions.validateCopy, false);
  assert.equal(result.verificationStatus, 'source_based');
});

test('manual mempertahankan intentional title-body overlap tanpa duplicate recovery', async () => {
  const evidence = 'Pengembang China mendominasi papan atas model video AI.';
  const title = 'China Dominasi Papan Atas';
  const body = 'Pengembang China mendominasi papan atas.';
  const slide = {
    section: 'ITEM 1', title, body, points: [],
    claims: [
      { field: 'slide:0:title', text: title, sourceId: 'source-1', evidence },
      { field: 'slide:0:body', text: body, sourceId: 'source-1', evidence }
    ]
  };
  const base = {
    focus: {}, topic: 'Model video AI China', hook: title, body, caption: body, hashtags: [], cta: title,
    trendKeywordsUsed: [], content_angle: 'peringkat', primary_tool: 'tanpa tool', hook_pattern: 'langsung',
    slides: [{ section: slide.section, title, body, points: [] }]
  };
  let verifierCalls = 0;
  let recoveryCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    if (/FINAL SAFE RECOVERY/i.test(prompt)) recoveryCalls += 1;
    else verifierCalls += 1;
    return { choices: [{ message: { content: JSON.stringify({ slides: [slide] }) } }] };
  } } } };

  const result = await generateFilteredContent({
    content: { async generateContent() { return base; }, validateContent() { return []; } },
    options: { topicSource: 'manual', useSources: true, requestedTopic: 'Model video AI China', contentFormat: 'Listicle' },
    sources: [{ url: 'https://example.test/ranking', text: evidence }],
    client
  });

  assert.equal(verifierCalls, 1);
  assert.equal(recoveryCalls, 0);
  assert.equal(result.slides[0].title, title);
  assert.equal(result.slides[0].body, body);
  assert.deepEqual(result.slides[0].points, []);
});
