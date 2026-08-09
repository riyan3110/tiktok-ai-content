const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  generateFilteredContent,
  requiresSourceEvidence,
  MAX_VERIFY_ATTEMPTS
} = require('../src/services/sourceFilter');

test('final safe recovery memperbaiki body, modalitas, dan menghapus point unsupported tanpa mengubah struktur', async () => {
  const evidence = 'Home robots can fold laundry while staying in one work area.';
  const source = { url: 'https://example.test/robots', text: evidence };
  const baseSlides = [
    { section: 'PEMBUKA', title: 'Sekilas tentang robot rumah', body: 'Lihat fakta utama dari sumber.', points: [] },
    { section: 'FAKTA UTAMA', title: 'Fakta utama', body: 'Robot rumah dapat menyelesaikan semua pekerjaan.', points: ['Resmi menghemat waktu'] },
    { section: 'KONTEKS', title: 'Konteks sumber', body: 'Cek batas kemampuan yang dijelaskan.', points: [] },
    { section: 'KESIMPULAN', title: 'Baca sesuai konteks', body: 'Simpan temuan yang relevan.', points: [] }
  ];
  const base = {
    focus: {}, topic: 'Robot melipat baju', hook: 'Robot rumah', body: 'Fakta robot', caption: 'Fakta robot',
    hashtags: [], cta: 'Baca sumber', trendKeywordsUsed: [], content_angle: 'fakta', primary_tool: 'tanpa tool',
    hook_pattern: 'langsung', slides: baseSlides
  };
  const badDraft = baseSlides.map(slide => ({ ...slide, points: [...slide.points], claims: [] }));
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
    options: { contentFormat: 'Fakta singkat', requestedTopic: 'Robot melipat baju' },
    sources: [source],
    client
  });

  assert.equal(verifierCalls, MAX_VERIFY_ATTEMPTS);
  assert.equal(safeCalls, 2);
  assert.equal(result.verificationStatus, 'source_based');
  assert.equal(result.slides[1].body, 'Robot rumah dapat melipat baju di satu area kerja.');
  assert.deepEqual(result.slides[1].points, []);
  assert.equal(result.slides[0].title, 'Sekilas tentang robot rumah');
  assert.equal(result.slides[0].body, 'Lihat fakta utama dari sumber.');
  assert.equal(result.slides[2].title, 'Konteks sumber');
  assert.equal(result.slides[2].body, 'Cek batas kemampuan yang dijelaskan.');
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
