const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  generateFilteredContent,
  requiresSourceEvidence,
  MAX_VERIFY_ATTEMPTS,
  MAX_SAFE_RECOVERY_ATTEMPTS
} = require('../src/services/sourceFilter');

test('manual safe recovery memperbaiki evidence lama lalu menghapus point unsupported tanpa mengubah struktur', async () => {
  const evidence = 'Home robots can fold laundry while staying in one work area.';
  const source = { url: 'https://example.test/robots', text: evidence };
  const baseSlides = [
    { section: 'PEMBUKA', title: 'Sekilas tentang robot rumah', body: 'Lihat fakta utama dari sumber.', points: [] },
    { section: 'FAKTA UTAMA', title: 'Fakta utama', body: 'Robot rumah dapat menyelesaikan semua pekerjaan.', points: ['Resmi menghemat waktu'] },
    { section: 'KONTEKS', title: 'Konteks sumber', body: 'Robot rumah dapat melipat baju di satu area kerja.', points: [] },
    { section: 'KESIMPULAN', title: 'Baca sesuai konteks', body: 'Simpan temuan yang relevan.', points: [] }
  ];
  const base = {
    focus: {}, topic: 'Robot melipat baju', hook: 'Robot rumah', body: 'Fakta robot', caption: 'Fakta robot',
    hashtags: [], cta: 'Baca sumber', trendKeywordsUsed: [], content_angle: 'fakta', primary_tool: 'tanpa tool',
    hook_pattern: 'langsung', slides: baseSlides
  };
  const badDraft = baseSlides.map((slide, index) => ({
    ...slide,
    points: [...slide.points],
    claims: index === 2 ? [{ field: 'slide:2:body', text: slide.body, sourceId: 'source-1', evidence }] : []
  }));
  const tooStrongDraft = badDraft.map((slide, index) => index === 1 ? {
    ...slide,
    body: 'Robot rumah pasti dapat melipat baju di satu area kerja.',
    claims: [{ field: 'slide:1:body', text: 'Robot rumah pasti dapat melipat baju di satu area kerja.', sourceId: 'source-1', evidence }]
  } : slide);
  tooStrongDraft[0] = { ...tooStrongDraft[0], title: 'Judul valid ikut diubah', body: 'Body valid ikut diubah' };
  const repairedDraft = badDraft.map((slide, index) => index === 1 ? {
    ...slide,
    body: 'Robot rumah dapat melipat baju di satu area kerja.',
    points: [],
    claims: [{ field: 'slide:1:body', text: 'Robot rumah dapat melipat baju di satu area kerja.', sourceId: 'source-1', evidence }]
  } : slide);
  repairedDraft[2] = { ...repairedDraft[2], title: 'Konteks valid ikut diubah', body: 'Field ini bukan target recovery.' };

  let verifierCalls = 0;
  let safeCalls = 0;
  let auditCalls = 0;
  let validatedRecoveredOutput = false;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      auditCalls += 1;
      const claims = JSON.parse(prompt.match(/CLAIMS: (\[[^\n]*\])/)[1]);
      const unsupported = [];
      if (claims.some(claim => claim.field === 'slide:1:body' && /pasti/i.test(claim.text))) {
        unsupported.push({ field: 'slide:1:body', reason: 'Evidence hanya menyebut can, bukan kepastian.' });
      }
      if (claims.some(claim => claim.field === 'slide:1:point:0')) {
        unsupported.push({ field: 'slide:1:point:0', reason: 'Evidence tidak menyebut penghematan waktu.' });
      }
      return { choices: [{ message: { content: JSON.stringify({ unsupported }) } }] };
    }
    if (/FINAL SAFE RECOVERY/i.test(prompt)) {
      safeCalls += 1;
      assert.match(prompt, /nested uncertainty, atau unsupported condition/);
      assert.match(prompt, /Pertahankan uncertainty wrapper, capability, subject\/actor/);
      assert.match(prompt, /jangan mengubah field lain atau menambah fakta maupun kondisi baru/);
      assert.match(prompt, /Untuk point yang gagal dan tidak punya dukungan tepat, hapus point/);
      assert.match(prompt, /FACT_BANK tidak punya evidence[^\n]*HAPUS point tersebut/);
      assert.doesNotMatch(prompt, /fakta relevan lain yang belum dipakai pada carousel/);
      const slides = safeCalls === 1 ? tooStrongDraft : repairedDraft;
      if (safeCalls === 1) slides[1].claims.push({
        field: 'slide:1:point:0', text: 'Resmi menghemat waktu', sourceId: 'source-1', evidence
      });
      return { choices: [{ message: { content: JSON.stringify({ slides }) } }] };
    }
    verifierCalls += 1;
    return { choices: [{ message: { content: JSON.stringify({ slides: badDraft }) } }] };
  } } } };

  const content = {
    async generateContent() { return base; },
    validateContent(value) {
      if (value.slides[1]?.body === 'Robot rumah dapat melipat baju di satu area kerja.') validatedRecoveredOutput = true;
      return value.slides.length === 4 ? [] : ['jumlah slide berubah'];
    }
  };
  const result = await generateFilteredContent({
    content,
    options: { topicSource: 'manual', useSources: true, requestedTopic: 'Robot melipat baju', contentFormat: 'Fakta singkat' },
    sources: [source],
    client
  });

  assert.equal(verifierCalls, MAX_VERIFY_ATTEMPTS);
  assert.equal(safeCalls, 2);
  assert.equal(result.verificationStatus, 'source_based');
  assert.equal(result.slides[1].body, 'Robot rumah dapat melipat baju di satu area kerja.');
  assert.deepEqual(result.slides[1].points, [], 'tanpa fakta pengganti yang aman, point invalid tetap dihapus');
  assert.equal(result.slides[0].title, 'Sekilas tentang robot rumah');
  assert.equal(result.slides[0].body, 'Lihat fakta utama dari sumber.');
  assert.equal(result.slides[2].title, 'Konteks sumber');
  assert.equal(result.slides[2].body, 'Robot rumah dapat melipat baju di satu area kerja.');
  assert.equal(validatedRecoveredOutput, true);
  assert.ok(auditCalls >= 2, 'hasil recovery harus tetap melewati semantic audit');
  assert.deepEqual(result.slides.map(slide => slide.section), ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN']);
  assert.equal(result.slides.length, 4);

  result.slides.forEach((slide, slideIndex) => {
    const claims = new Set((slide.claims || []).map(claim => claim.field));
    const fields = [
      ['title', slide.title], ['body', slide.body],
      ...(slide.points || []).map((point, pointIndex) => [`point:${pointIndex}`, point])
    ];
    fields.forEach(([kind, value]) => {
      const fieldKind = kind.startsWith('point:') ? 'point' : kind;
      if (requiresSourceEvidence(value, slide.section, fieldKind, slideIndex, result.slides.length, 'Fakta singkat')) {
        assert.ok(claims.has(`slide:${slideIndex}:${kind}`), `${kind} faktual harus memiliki evidence`);
      }
    });
  });
});

test('AI safe recovery mengganti hanya point target dengan fakta FACT_BANK yang belum dipakai', async () => {
  const factA = 'Aurora berada di posisi pertama dalam peringkat model video.';
  const factB = 'Peringkat model video ditentukan melalui voting blind.';
  const source = { url: 'https://example.test/ranking', text: `${factA} ${factB}` };
  const unsupportedPoint = 'Aurora memiliki kualitas warna terbaik.';
  const replacementPoint = 'Peringkat memakai voting blind';
  const slides = [
    { section: 'PEMBUKA', title: 'Peringkat Model Video', body: 'Lihat fakta utama dalam pemeringkatan.', points: [], claims: [] },
    {
      section: 'ITEM 1', title: 'Aurora Memimpin', body: 'Aurora berada di posisi pertama dalam peringkat model video.', points: [],
      claims: [{ field: 'slide:1:body', text: 'Aurora berada di posisi pertama dalam peringkat model video.', sourceId: 'source-1', evidence: factA }]
    },
    {
      section: 'ITEM 2', title: 'Cara Penilaian', body: '', points: [unsupportedPoint],
      claims: [{ field: 'slide:2:point:0', text: unsupportedPoint, sourceId: 'source-1', evidence: factA }]
    },
    { section: 'PENUTUP', title: 'Konteks Peringkat', body: 'Bandingkan hasil sesuai metode penilaiannya.', points: [], claims: [] }
  ];
  const base = {
    focus: {}, topic: 'Peringkat model video', hook: slides[0].title, body: slides[0].body, caption: slides[0].body,
    hashtags: [], cta: slides.at(-1).title, trendKeywordsUsed: [], content_angle: 'peringkat', primary_tool: 'tanpa tool',
    hook_pattern: 'listicle', slides
  };
  const recoveredSlides = slides.map(slide => ({ ...slide, points: [...slide.points], claims: slide.claims.map(claim => ({ ...claim })) }));
  recoveredSlides[2] = {
    ...recoveredSlides[2],
    title: 'Field non-target tidak boleh berubah',
    points: [replacementPoint],
    claims: [{ field: 'slide:2:point:0', text: replacementPoint, sourceId: 'source-1', evidence: factB }]
  };
  let verifierCalls = 0;
  let recoveryCalls = 0;
  let auditCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      auditCalls += 1;
      const claims = JSON.parse(prompt.match(/CLAIMS: (\[[^\n]*\])/)[1]);
      const unsupported = claims.some(claim => claim.field === 'slide:2:point:0' && claim.text === unsupportedPoint)
        ? [{ field: 'slide:2:point:0', reason: 'Evidence tidak menyebut kualitas warna.' }]
        : [];
      return { choices: [{ message: { content: JSON.stringify({ unsupported }) } }] };
    }
    if (/FINAL SAFE RECOVERY/i.test(prompt)) {
      recoveryCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ slides: recoveredSlides }) } }] };
    }
    verifierCalls += 1;
    return { choices: [{ message: { content: JSON.stringify({ slides }) } }] };
  } } } };
  const content = { async generateContent() { return base; }, validateContent() { return []; } };

  const result = await generateFilteredContent({
    content,
    options: { topicSource: 'ai', useSources: true, requestedTopic: '', mainTopic: 'Peringkat model video', contentFormat: 'Listicle' },
    sources: [source],
    client
  });

  assert.equal(verifierCalls, MAX_VERIFY_ATTEMPTS);
  assert.equal(recoveryCalls, 1);
  assert.ok(auditCalls >= MAX_VERIFY_ATTEMPTS + 1, 'semantic audit harus dijalankan lagi sesudah recovery');
  assert.equal(result.slides[2].title, slides[2].title, 'field non-target harus tetap terkunci');
  assert.equal(result.slides[2].points[0], replacementPoint);
  assert.equal(result.slides[2].claims[0].evidence, factB);
  const displayFields = slide => ({ section: slide.section, title: slide.title, body: slide.body, points: slide.points });
  assert.deepEqual(result.slides.filter((_, index) => index !== 2).map(displayFields), slides.filter((_, index) => index !== 2).map(displayFields));
});

test('Fakta singkat me-retry body question-only hingga menjadi fakta tanpa mengubah field non-target', async () => {
  const evidence = 'User-generated content can help brands build trust with their audiences.';
  const opening = { section: 'PEMBUKA', title: 'Apa itu UGC?', body: 'Kenali perannya dalam pemasaran.', points: [], claims: [] };
  const main = { section: 'FAKTA UTAMA', title: 'Mengapa UGC penting?', body: 'Bagaimana UGC membantu membangun kepercayaan?', points: [], claims: [] };
  const context = {
    section: 'KONTEKS', title: 'Konteks UGC', body: 'UGC dapat membantu brand membangun kepercayaan audiens.', points: [],
    claims: [{ field: 'slide:2:body', text: 'UGC dapat membantu brand membangun kepercayaan audiens.', sourceId: 'source-1', evidence }]
  };
  const conclusion = { section: 'KESIMPULAN', title: 'Ringkasannya', body: 'Baca sesuai konteks sumber.', points: [], claims: [] };
  const base = {
    focus: {}, topic: 'UGC', hook: opening.title, body: opening.body, caption: opening.body,
    hashtags: [], cta: conclusion.title, trendKeywordsUsed: [], content_angle: 'fakta', primary_tool: 'tanpa tool',
    hook_pattern: 'pertanyaan', slides: [opening, main, context, conclusion]
  };
  let verifierCalls = 0;
  let safeCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    if (/FINAL SAFE RECOVERY/i.test(prompt)) {
      safeCalls += 1;
      const body = safeCalls === 1
        ? 'Bagaimana manfaat UGC bagi brand?'
        : 'UGC dapat membantu brand membangun kepercayaan audiens.';
      return { choices: [{ message: { content: JSON.stringify({ slides: [
        { ...opening, title: 'Pembuka tidak boleh berubah' },
        { ...main, title: 'Title non-target tidak boleh berubah', body, claims: safeCalls === 1 ? [] : [{ field: 'slide:1:body', text: body, sourceId: 'source-1', evidence }] },
        { ...context, body: 'Konteks non-target tidak boleh berubah' },
        conclusion
      ] }) } }] };
    }
    verifierCalls += 1;
    return { choices: [{ message: { content: JSON.stringify({ slides: [opening, main, context, conclusion] }) } }] };
  } } } };
  const content = { async generateContent() { return base; }, validateContent() { return []; } };

  const result = await generateFilteredContent({
    content,
    options: { contentFormat: 'Fakta singkat', requestedTopic: 'UGC' },
    sources: [{ url: 'https://example.test/ugc', text: evidence }],
    client
  });

  assert.equal(verifierCalls, MAX_VERIFY_ATTEMPTS, 'question-only tidak boleh langsung lolos verifier');
  assert.equal(safeCalls, 2, 'pertanyaan pengganti harus ditolak dan di-retry');
  assert.equal(result.slides[1].title, main.title);
  assert.equal(result.slides[1].body, 'UGC dapat membantu brand membangun kepercayaan audiens.');
  assert.equal(result.slides[1].claims[0].evidence, evidence);
  assert.deepEqual(result.slides[0], opening);
  assert.deepEqual(result.slides[2], context);
});

test('filler + unrelated evidence tidak dapat memenuhi Fakta singkat middle-slide fact gate', async () => {
  const evidence = 'User-generated content can help brands build trust with their audiences.';
  const filler = 'Baca informasi selengkapnya.';
  const fact = 'UGC dapat membantu brand membangun kepercayaan audiens.';
  const opening = { section: 'PEMBUKA', title: 'Apa itu UGC?', body: 'Kenali perannya dalam pemasaran.', points: [], claims: [] };
  const main = {
    section: 'FAKTA UTAMA', title: 'Mengapa UGC penting?', body: filler, points: [],
    claims: [{ field: 'slide:1:body', text: filler, sourceId: 'source-1', evidence }]
  };
  const context = {
    section: 'KONTEKS', title: 'Konteks UGC', body: fact, points: [],
    claims: [{ field: 'slide:2:body', text: fact, sourceId: 'source-1', evidence }]
  };
  const conclusion = { section: 'KESIMPULAN', title: 'Ringkasannya', body: 'Baca sesuai konteks sumber.', points: [], claims: [] };
  const base = {
    focus: {}, topic: 'UGC', hook: opening.title, body: opening.body, caption: opening.body,
    hashtags: [], cta: conclusion.title, trendKeywordsUsed: [], content_angle: 'fakta', primary_tool: 'tanpa tool',
    hook_pattern: 'pertanyaan', slides: [opening, main, context, conclusion]
  };
  let fillerAuditCalls = 0;
  let safeCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      const claims = JSON.parse(prompt.match(/CLAIMS: (\[[^\n]*\])/)[1]);
      const fillerClaim = claims.find(claim => claim.field === 'slide:1:body' && claim.text === filler);
      if (fillerClaim) fillerAuditCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({
        unsupported: fillerClaim ? [{ field: 'slide:1:body', reason: 'Evidence tidak mendukung filler.' }] : []
      }) } }] };
    }
    if (/FINAL SAFE RECOVERY/i.test(prompt)) {
      safeCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ slides: [
        { ...opening, title: 'Pembuka non-target tidak boleh berubah' },
        { ...main, title: 'Title non-target tidak boleh berubah', body: fact, claims: [{ field: 'slide:1:body', text: fact, sourceId: 'source-1', evidence }] },
        { ...context, body: 'Konteks non-target tidak boleh berubah' },
        conclusion
      ] }) } }] };
    }
    return { choices: [{ message: { content: JSON.stringify({ slides: [opening, main, context, conclusion] }) } }] };
  } } } };
  const content = { async generateContent() { return base; }, validateContent() { return []; } };

  const result = await generateFilteredContent({
    content,
    options: { contentFormat: 'Fakta singkat', requestedTopic: 'UGC' },
    sources: [{ url: 'https://example.test/ugc', text: evidence }],
    client
  });

  assert.equal(fillerAuditCalls, MAX_VERIFY_ATTEMPTS, 'claim filler harus dipertahankan dan diperiksa semantic audit');
  assert.equal(safeCalls, 1);
  assert.equal(result.slides[1].body, fact);
  assert.equal(result.slides[1].claims[0].evidence, evidence);
  assert.deepEqual(result.slides[0], opening);
  assert.deepEqual(result.slides[2], context);
});

test('safe recovery berhenti pada hard limit ketika provider selalu memberi draft invalid yang berbeda', async () => {
  const evidence = 'Home robots can fold laundry while staying in one work area.';
  const slides = [{
    section: 'PEMBUKA', title: 'Fakta robot rumah', body: 'Robot dapat menyelesaikan 99 pekerjaan.', points: [], claims: []
  }];
  const base = {
    focus: {}, topic: 'Robot rumah', hook: 'Fakta robot rumah', body: slides[0].body, caption: 'Fakta robot',
    hashtags: [], cta: 'Baca sumber', trendKeywordsUsed: [], content_angle: 'fakta', primary_tool: 'tanpa tool',
    hook_pattern: 'langsung', slides
  };
  let verifierCalls = 0;
  let safeCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    if (/FINAL SAFE RECOVERY/i.test(messages[1].content)) {
      safeCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({
        slides: [{ ...slides[0], body: `Robot dapat menyelesaikan ${100 + safeCalls} pekerjaan.`, claims: [] }]
      }) } }] };
    }
    verifierCalls += 1;
    return { choices: [{ message: { content: JSON.stringify({ slides }) } }] };
  } } } };
  const content = {
    async generateContent() { return base; },
    validateContent() { return []; }
  };

  await assert.rejects(generateFilteredContent({
    content,
    options: { contentFormat: 'Fakta singkat', requestedTopic: 'Robot rumah' },
    sources: [{ url: 'https://example.test/robots', text: evidence }],
    client
  }), error => error.status === 422 && /tidak dapat diproses setelah safe recovery/i.test(error.message));

  assert.equal(verifierCalls, MAX_VERIFY_ATTEMPTS);
  assert.equal(safeCalls, MAX_SAFE_RECOVERY_ATTEMPTS);
});

test('AI emergency fallback menetralkan hanya factual title setelah seluruh safe recovery gagal', async () => {
  const bodyEvidence = 'Model Orion menggunakan evaluasi blind untuk membandingkan hasil video.';
  const pointEvidence = 'Penilai memilih hasil terbaik tanpa mengetahui nama model pembuatnya.';
  const source = { url: 'https://example.test/orion', text: `${bodyEvidence} ${pointEvidence}` };
  const targetBody = 'Model Orion menggunakan evaluasi blind untuk membandingkan hasil video.';
  const targetPoint = 'Penilai tidak mengetahui nama model';
  const invalidEvidence = 'Model Orion resmi merilis versi terbaru untuk semua pengguna.';
  const baseSlides = [
    { section: 'PEMBUKA', title: 'Evaluasi Model Video', body: 'Periksa metode evaluasi dari sumber.', points: [], claims: [] },
    { section: 'ITEM 1', title: 'Metode Penilaian', body: 'Bandingkan hasil sesuai metode sumber.', points: [], claims: [] },
    {
      section: 'ITEM 2', title: 'Orion Merilis Model Terbaru', body: targetBody, points: [targetPoint],
      claims: [
        { field: 'slide:2:title', text: 'Orion Merilis Model Terbaru', sourceId: 'source-1', evidence: invalidEvidence },
        { field: 'slide:2:body', text: targetBody, sourceId: 'source-1', evidence: bodyEvidence },
        { field: 'slide:2:point:0', text: targetPoint, sourceId: 'source-1', evidence: pointEvidence }
      ]
    },
    { section: 'PENUTUP', title: 'Ringkasan Metode', body: 'Simpan konteks penilaiannya.', points: [], claims: [] }
  ];
  const base = {
    focus: {}, topic: 'Evaluasi Model Orion', hook: baseSlides[0].title, body: baseSlides[0].body, caption: baseSlides[0].body,
    hashtags: [], cta: baseSlides.at(-1).title, trendKeywordsUsed: [], content_angle: 'evaluasi', primary_tool: 'Orion',
    hook_pattern: 'langsung', slides: baseSlides
  };
  const draftWithTitle = title => baseSlides.map((slide, slideIndex) => ({
    ...slide,
    points: [...slide.points],
    claims: slide.claims.map(claim => ({
      ...claim,
      ...(slideIndex === 2 && claim.field === 'slide:2:title' ? { text: title } : {})
    })),
    ...(slideIndex === 2 ? { title } : {})
  }));

  let verifierCalls = 0;
  let safeCalls = 0;
  let auditCalls = 0;
  let fallbackValidationCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      auditCalls += 1;
      const claims = JSON.parse(prompt.match(/CLAIMS: (\[[^\n]*\])/)[1]);
      assert.ok(!claims.some(claim => claim.field === 'slide:2:title'), 'claim title invalid harus dibuang sebelum semantic audit final');
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    if (/FINAL SAFE RECOVERY/i.test(prompt)) {
      safeCalls += 1;
      const title = `Orion Merilis Model Versi ${safeCalls}`;
      return { choices: [{ message: { content: JSON.stringify({ slides: draftWithTitle(title) }) } }] };
    }
    verifierCalls += 1;
    return { choices: [{ message: { content: JSON.stringify({ slides: draftWithTitle('Orion Merilis Model Terbaru') }) } }] };
  } } } };
  const content = {
    async generateContent() { return base; },
    validateContent(value) {
      if (value.slides[2]?.title === 'Poin Berikutnya') fallbackValidationCalls += 1;
      return [];
    }
  };

  const result = await generateFilteredContent({
    content,
    options: { topicSource: 'ai', useSources: true, requestedTopic: '', mainTopic: 'Evaluasi Model Orion', contentFormat: 'Listicle' },
    sources: [source],
    client
  });

  assert.equal(verifierCalls, MAX_VERIFY_ATTEMPTS);
  assert.equal(safeCalls, MAX_SAFE_RECOVERY_ATTEMPTS, 'fallback hanya boleh berjalan setelah safe recovery benar-benar habis');
  assert.equal(fallbackValidationCalls, 1, 'hasil title netral harus melewati validateVerifiedContent ulang');
  assert.equal(auditCalls, 1, 'semantic audit harus dijalankan setelah fallback');
  assert.equal(result.slides[2].title, 'Poin Berikutnya');
  assert.equal(requiresSourceEvidence(result.slides[2].title, result.slides[2].section, 'title', 2, 4, 'Listicle'), false);
  assert.doesNotMatch(result.slides[2].title, /Orion|model|rilis|versi|terbaru/i, 'title netral tidak boleh memperkenalkan fakta baru');
  assert.equal(result.slides[2].body, targetBody);
  assert.deepEqual(result.slides[2].points, [targetPoint]);
  assert.deepEqual(result.slides[2].claims, [
    { field: 'slide:2:body', text: targetBody, sourceId: 'source-1', evidence: bodyEvidence },
    { field: 'slide:2:point:0', text: targetPoint, sourceId: 'source-1', evidence: pointEvidence }
  ]);
  assert.deepEqual(result.slides.filter((_, index) => index !== 2), baseSlides.filter((_, index) => index !== 2));
});

test('emergency title fallback tidak menerima slide dengan body dan points yang tetap tidak grounded', async () => {
  const evidence = 'Model Orion menggunakan evaluasi blind untuk membandingkan hasil video.';
  const invalidEvidence = 'Model Orion resmi merilis versi terbaru untuk semua pengguna.';
  const slides = [
    { section: 'PEMBUKA', title: 'Evaluasi Model Video', body: 'Periksa metode evaluasi dari sumber.', points: [], claims: [] },
    { section: 'ITEM 1', title: 'Metode Penilaian', body: 'Bandingkan hasil sesuai metode sumber.', points: [], claims: [] },
    {
      section: 'ITEM 2', title: 'Orion Merilis Model Terbaru', body: 'Orion meningkatkan kualitas video hingga 99 persen.', points: ['Hasil pasti lebih akurat'],
      claims: [{ field: 'slide:2:title', text: 'Orion Merilis Model Terbaru', sourceId: 'source-1', evidence: invalidEvidence }]
    },
    { section: 'PENUTUP', title: 'Ringkasan Metode', body: 'Simpan konteks penilaiannya.', points: [], claims: [] }
  ];
  const base = {
    focus: {}, topic: 'Evaluasi Model Orion', hook: slides[0].title, body: slides[0].body, caption: slides[0].body,
    hashtags: [], cta: slides.at(-1).title, trendKeywordsUsed: [], content_angle: 'evaluasi', primary_tool: 'Orion',
    hook_pattern: 'langsung', slides
  };
  let safeCalls = 0;
  let auditCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    if (/auditor entailment fakta bilingual/i.test(messages[1].content)) {
      auditCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    if (/FINAL SAFE RECOVERY/i.test(messages[1].content)) safeCalls += 1;
    const title = `Orion Merilis Model Versi ${safeCalls}`;
    const candidate = slides.map((slide, index) => index === 2 ? {
      ...slide,
      title,
      claims: [{ field: 'slide:2:title', text: title, sourceId: 'source-1', evidence: invalidEvidence }]
    } : slide);
    return { choices: [{ message: { content: JSON.stringify({ slides: candidate }) } }] };
  } } } };
  const content = { async generateContent() { return base; }, validateContent() { return []; } };

  await assert.rejects(generateFilteredContent({
    content,
    options: { topicSource: 'ai', useSources: true, requestedTopic: '', mainTopic: 'Evaluasi Model Orion', contentFormat: 'Listicle' },
    sources: [{ url: 'https://example.test/orion', text: evidence }],
    client
  }), error => error.status === 422 && /safe recovery|filter fakta sumber/i.test(error.message));

  assert.equal(safeCalls, MAX_SAFE_RECOVERY_ATTEMPTS);
  assert.equal(auditCalls, 0, 'output dengan body/points invalid tidak boleh mencapai semantic audit atau diterima');
});

test('emergency grounding fallback tidak menyembunyikan error title non-grounding', async () => {
  const evidence = 'Model Orion menggunakan evaluasi blind untuk membandingkan hasil video.';
  const slides = [
    { section: 'PEMBUKA', title: 'Metode Evaluasi', body: 'Periksa metode dari sumber.', points: [], claims: [] },
    { section: 'ITEM 1', title: 'Proses Penilaian', body: 'Bandingkan hasil sesuai konteks.', points: [], claims: [] },
    { section: 'ITEM 2', title: 'Newsletter subscribe sekarang', body: 'Simpan bagian yang relevan.', points: [], claims: [] },
    { section: 'PENUTUP', title: 'Catatan Akhir', body: 'Baca konteks secara lengkap.', points: [], claims: [] }
  ];
  const base = {
    focus: {}, topic: 'Evaluasi Orion', hook: slides[0].title, body: slides[0].body, caption: slides[0].body,
    hashtags: [], cta: slides.at(-1).title, trendKeywordsUsed: [], content_angle: 'evaluasi', primary_tool: 'Orion',
    hook_pattern: 'langsung', slides
  };
  let safeCalls = 0;
  let neutralFallbackValidation = 0;
  const client = { chat: { completions: { async create({ messages }) {
    if (/FINAL SAFE RECOVERY/i.test(messages[1].content)) safeCalls += 1;
    const candidate = slides.map((slide, index) => index === 2
      ? { ...slide, title: `Newsletter subscribe edisi ${safeCalls}` }
      : slide);
    return { choices: [{ message: { content: JSON.stringify({ slides: candidate }) } }] };
  } } } };
  const content = {
    async generateContent() { return base; },
    validateContent(value) {
      if (value.slides[2]?.title === 'Poin Berikutnya') neutralFallbackValidation += 1;
      return [];
    }
  };

  await assert.rejects(generateFilteredContent({
    content,
    options: { topicSource: 'ai', useSources: true, requestedTopic: '', mainTopic: 'Evaluasi Orion', contentFormat: 'Listicle' },
    sources: [{ url: 'https://example.test/orion', text: evidence }],
    client
  }), error => error.status === 422 && /metadata\/boilerplate/i.test(error.validationErrors.join(' ')));

  assert.equal(safeCalls, MAX_SAFE_RECOVERY_ATTEMPTS);
  assert.equal(neutralFallbackValidation, 0, 'fallback factual-title tidak boleh dipakai untuk menyembunyikan boilerplate title');
});

test('manual title exhaustion gagal tanpa emergency neutral-title fallback', async () => {
  const evidence = 'Model Orion menggunakan evaluasi blind untuk membandingkan hasil video.';
  const invalidEvidence = 'Model Orion resmi merilis versi terbaru untuk semua pengguna.';
  const originalTitle = 'Orion Merilis Model Terbaru';
  const baseSlide = { section: 'ITEM 1', title: originalTitle, body: evidence, points: [] };
  const base = {
    focus: {}, topic: 'Evaluasi Model Orion', hook: originalTitle, body: evidence, caption: evidence,
    hashtags: [], cta: originalTitle, trendKeywordsUsed: [], content_angle: 'evaluasi', primary_tool: 'Orion',
    hook_pattern: 'langsung', slides: [baseSlide]
  };
  let generatedTitle = 0;
  let neutralFallbackValidation = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    generatedTitle += 1;
    const title = `Orion Merilis Model Versi ${generatedTitle}`;
    return { choices: [{ message: { content: JSON.stringify({ slides: [{
      ...baseSlide,
      title,
      claims: [
        { field: 'slide:0:title', text: title, sourceId: 'source-1', evidence: invalidEvidence },
        { field: 'slide:0:body', text: evidence, sourceId: 'source-1', evidence }
      ]
    }] }) } }] };
  } } } };
  const neutralLabels = new Set(['Gambaran Utama', 'Konteks Penting', 'Poin Berikutnya', 'Inti Pembahasan', 'Ringkasan']);
  const content = {
    async generateContent() { return base; },
    validateContent(value) {
      if (neutralLabels.has(value.slides[0]?.title)) neutralFallbackValidation += 1;
      return [];
    }
  };

  await assert.rejects(generateFilteredContent({
    content,
    options: { topicSource: 'manual', useSources: true, requestedTopic: 'Evaluasi Model Orion', contentFormat: 'Listicle' },
    sources: [{ url: 'https://example.test/orion', text: evidence }],
    client
  }), error => error.status === 422 && /safe recovery|filter fakta sumber/i.test(error.message));

  assert.equal(neutralFallbackValidation, 0);
});
