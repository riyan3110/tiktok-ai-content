const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  repairManualSourceRoles,
  deterministicRoleErrors,
  looksLikeUserAction,
  MAX_ROLE_AUDIT_ATTEMPTS
} = require('../src/services/manualSourceRoleGuard');

function claim(field, text, evidence) {
  return { field, text, sourceId: 'source-1', evidence };
}

function baseContent(slides) {
  return {
    focus: { masalah: 'Akses akun asing', penyebab: 'Perangkat tidak dikenal', solusi: 'Periksa akses', hasil: 'Risiko berkurang' },
    topic: 'Tanda WhatsApp disadap dan cara stopnya',
    hook: slides[0].title,
    body: slides[0].body,
    caption: slides[0].body,
    hashtags: [],
    cta: slides.at(-1).title,
    trendKeywordsUsed: [],
    content_angle: 'keamanan WhatsApp',
    primary_tool: 'WhatsApp',
    hook_pattern: 'langsung',
    verificationStatus: 'source_based',
    unsupportedClaims: [],
    slides
  };
}

test('Masalah dan solusi menolak SOLUSI yang body-nya bukan tindakan pengguna', () => {
  const content = baseContent([
    { section: 'MASALAH', title: 'Tanda WhatsApp Disadap', body: 'Ada tanda akses yang tidak dikenal.', points: [], claims: [] },
    { section: 'SOLUSI', title: 'Langkah Awal Mengamankan Akun', body: 'Mengenali tanda penyadapan menjadi langkah awal mengamankan akun.', points: [], claims: [] },
    { section: 'SOLUSI', title: 'Batasi Akses Aplikasi Pihak Ketiga', body: 'OTP biasanya dikirim melalui SMS ketika seseorang mencoba mengakses WhatsApp.', points: [], claims: [] },
    { section: 'HASIL', title: 'Pentingnya Keamanan WhatsApp', body: 'Kondisi tersebut perlu mendapat perhatian karena WhatsApp tidak hanya untuk berkomunikasi.', points: [], claims: [] }
  ]);

  assert.deepEqual(deterministicRoleErrors(content, 'Masalah dan solusi'), [
    'slide:1:role: SOLUSI harus berisi tindakan konkret yang dilakukan pengguna; judul aksi saja tidak cukup jika body/points hanya menjelaskan tanda, risiko, mekanisme, atau konteks.',
    'slide:2:role: SOLUSI harus berisi tindakan konkret yang dilakukan pengguna; judul aksi saja tidak cukup jika body/points hanya menjelaskan tanda, risiko, mekanisme, atau konteks.',
    'slide:3:role: HASIL tidak boleh dipakai ketika tindakan pengguna sebelumnya belum valid.'
  ]);
  assert.equal(looksLikeUserAction('OTP biasanya dikirim melalui SMS.'), false);
  assert.equal(looksLikeUserAction('Periksa perangkat tertaut di WhatsApp.'), true);
});

test('role recovery mengganti SOLUSI tidak nyambung dengan tindakan source-backed dan memperbaiki HASIL', async () => {
  const sign = 'Kode OTP tanpa permintaan dapat menjadi tanda percobaan akses ke akun WhatsApp.';
  const linked = 'Pengguna dapat memeriksa perangkat tertaut dan mengeluarkan perangkat yang tidak dikenal.';
  const twoStep = 'Pengguna dapat mengaktifkan verifikasi dua langkah dan menambahkan email pemulihan.';
  const outcome = 'Mengenali tanda lebih awal dan menggunakan fitur keamanan dapat meminimalkan risiko pembajakan akun.';

  const generated = baseContent([
    {
      section: 'MASALAH', title: 'Tanda WhatsApp Disadap', body: sign, points: [],
      claims: [claim('slide:0:body', sign, sign)]
    },
    {
      section: 'SOLUSI', title: 'Langkah Awal Mengamankan Akun', body: 'Mengenali tanda penyadapan menjadi langkah awal mengamankan akun.', points: [], claims: []
    },
    {
      section: 'SOLUSI', title: 'Batasi Akses Aplikasi Pihak Ketiga', body: 'OTP biasanya dikirim melalui SMS ketika seseorang mencoba mengakses WhatsApp.', points: [], claims: []
    },
    {
      section: 'HASIL', title: 'Pentingnya Keamanan WhatsApp', body: 'WhatsApp tidak hanya digunakan untuk berkomunikasi.', points: [], claims: []
    }
  ]);

  const repairedSlides = [
    generated.slides[0],
    {
      section: 'SOLUSI', title: 'Periksa Perangkat yang Tertaut', body: linked, points: [],
      claims: [claim('slide:1:body', linked, linked)]
    },
    {
      section: 'SOLUSI', title: 'Aktifkan Verifikasi Dua Langkah', body: twoStep, points: [],
      claims: [claim('slide:2:body', twoStep, twoStep)]
    },
    {
      section: 'HASIL', title: 'Kurangi Risiko Pembajakan Akun', body: outcome, points: [],
      claims: [claim('slide:3:body', outcome, outcome)]
    }
  ];

  let roleAuditCalls = 0;
  let repairCalls = 0;
  let semanticCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/AUDIT PERAN FORMAT/i.test(prompt)) {
      roleAuditCalls += 1;
      if (roleAuditCalls === 1) return { choices: [{ message: { content: JSON.stringify({
        formatFit: true,
        invalid: [
          { slideIndex: 1, role: 'SOLUSI', reason: 'Body bukan tindakan pengguna.' },
          { slideIndex: 2, role: 'SOLUSI', reason: 'Judul solusi tidak sesuai body OTP.' },
          { slideIndex: 3, role: 'HASIL', reason: 'Bukan outcome dari solusi.' }
        ]
      }) } }] };
      return { choices: [{ message: { content: JSON.stringify({ formatFit: true, invalid: [] }) } }] };
    }
    if (/PERBAIKAN ROLE FORMAT/i.test(prompt)) {
      repairCalls += 1;
      assert.match(prompt, /title dan body\/points harus membahas tindakan yang sama/i);
      assert.match(prompt, /Jangan membuat judul solusi yang tidak didukung body\/evidence/i);
      return { choices: [{ message: { content: JSON.stringify({ slides: repairedSlides }) } }] };
    }
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      semanticCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    throw new Error(`Unexpected call: ${prompt.slice(0, 100)}`);
  } } } };

  const result = await repairManualSourceRoles({
    contentService: { validateContent() { return []; } },
    generated,
    options: {
      topicSource: 'manual', useSources: true,
      requestedTopic: 'Tanda WhatsApp disadap dan cara stopnya',
      contentFormat: 'Masalah dan solusi'
    },
    sources: [{ url: 'https://example.test/whatsapp', text: [sign, linked, twoStep, outcome].join(' ') }],
    client
  });

  assert.equal(roleAuditCalls, 2, 'hasil recovery diaudit ulang');
  assert.equal(repairCalls, 1);
  assert.equal(semanticCalls, 1, 'replacement claim diaudit sebelum diterima');
  assert.equal(result.slides[0].body, sign, 'MASALAH valid tetap dikunci');
  assert.equal(result.slides[1].body, linked);
  assert.equal(result.slides[2].body, twoStep);
  assert.equal(result.slides[3].body, outcome);
  assert.deepEqual(result.slides.map(slide => slide.section), ['MASALAH', 'SOLUSI', 'SOLUSI', 'HASIL']);
});

test('audit role gagal tidak pernah dianggap sebagai approval', async () => {
  const action1 = 'Pengguna dapat memeriksa perangkat tertaut di WhatsApp.';
  const action2 = 'Pengguna dapat mengeluarkan perangkat yang tidak dikenal.';
  const outcome = 'Mengeluarkan perangkat tersebut akan mengakhiri sesi pada perangkat itu.';
  const generated = baseContent([
    { section: 'PEMBUKA', title: 'Periksa Akses Akun', body: 'Periksa akses akun.', points: [], claims: [] },
    { section: 'LANGKAH 1', title: 'Periksa Perangkat', body: action1, points: [], claims: [claim('slide:1:body', action1, action1)] },
    { section: 'LANGKAH 2', title: 'Keluarkan Perangkat Asing', body: action2, points: [], claims: [claim('slide:2:body', action2, action2)] },
    { section: 'HASIL/PENUTUP', title: 'Sesi Berakhir', body: outcome, points: [], claims: [claim('slide:3:body', outcome, outcome)] }
  ]);

  let auditCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    if (/AUDIT PERAN FORMAT/i.test(messages[1].content)) {
      auditCalls += 1;
      return { choices: [{ message: { content: '{invalid json' } }] };
    }
    throw new Error('Tidak boleh masuk recovery setelah audit gagal total.');
  } } } };

  await assert.rejects(() => repairManualSourceRoles({
    contentService: { validateContent() { return []; } },
    generated,
    options: { topicSource: 'manual', useSources: true, requestedTopic: 'Periksa akses WhatsApp', contentFormat: 'Tutorial langkah' },
    sources: [{ url: 'https://example.test/tutorial', text: [action1, action2, outcome].join(' ') }],
    client
  }), error => error?.status === 422 && /tidak boleh dianggap valid tanpa audit/i.test(error.message));

  assert.equal(auditCalls, MAX_ROLE_AUDIT_ATTEMPTS);
});
