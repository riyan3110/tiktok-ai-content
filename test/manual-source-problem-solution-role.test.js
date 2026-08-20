const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  repairManualSourceRoles,
  deterministicRoleErrors,
  contentDensityErrors,
  looksLikeUserAction,
  auditRoles,
  MAX_ROLE_AUDIT_ATTEMPTS
} = require('../src/services/manualSourceRoleGuard');

function claim(field, text, evidence) {
  return { field, text, sourceId: 'source-1', evidence };
}

function baseContent(slides, topic = 'Keamanan WhatsApp') {
  return {
    focus: { masalah: 'Risiko akses akun', penyebab: 'Konfigurasi dan akses', solusi: 'Periksa pengaturan', hasil: 'Kontrol akun' },
    topic,
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

test('final guard menangkap kasus produksi: semua slide tipis, PENYEBAB mengambil jatah solusi, dan fitur bukan SOLUSI', () => {
  const content = baseContent([
    { section: 'intro', title: 'Kenapa keamanan WhatsApp penting?', body: 'Data pribadi lewat chat bisa disalahgunakan bila tidak terlindungi.', points: ['Data pribadi tersimpan', 'Chat berisi info sensitif'], claims: [] },
    { section: 'masalah', title: 'Ancaman umum pada WhatsApp', body: 'Aplikasi tidak resmi meningkatkan risiko kebocoran data WhatsApp.', points: [], claims: [] },
    { section: 'penyebab', title: 'Mengapa akun mudah diretas', body: 'Batasan keamanan lokal harus diaktifkan secara manual.', points: [], claims: [] },
    { section: 'solusi', title: 'Langkah mudah lindungi akun', body: 'Konektivitas Multi-Device memungkinkan empat perangkat pendamping.', points: [], claims: [] },
    { section: 'penutup', title: 'Kesimpulan', body: 'Dengan langkah sederhana, chat tetap aman dan kamu bebas berinteraksi.', points: [], claims: [] }
  ]);
  const bank = Array.from({ length: 6 }, (_, index) => ({
    sourceId: 'source-1',
    evidence: `Fakta WhatsApp ${index + 1} menyediakan informasi berbeda yang cukup panjang untuk pengujian kualitas carousel.`
  }));

  const roleErrors = deterministicRoleErrors(content, 'Masalah dan solusi');
  const densityErrors = contentDensityErrors(content, bank);
  assert.ok(roleErrors.some(error => /slide:3:role: SOLUSI/.test(error)));
  assert.ok(roleErrors.some(error => /minimal dua SOLUSI/i.test(error)));
  for (let index = 0; index < 5; index += 1) {
    assert.ok(densityErrors.some(error => error.startsWith(`slide:${index}:density:`)), `slide ${index + 1} harus ditandai tipis`);
  }
  assert.ok(densityErrors.some(error => /penutup masih generik/i.test(error)));
  assert.ok(densityErrors.some(error => /^coverage:density:/.test(error)));
});

test('aksi pengguna dengan frasa pengantar diterima, tindakan pelaku tetap ditolak', () => {
  assert.equal(looksLikeUserAction('Di menu keamanan, pilih perangkat tertaut.'), true);
  assert.equal(looksLikeUserAction('Setelah itu, periksa perangkat tertaut.'), true);
  assert.equal(looksLikeUserAction('Pengguna dapat mengaktifkan verifikasi dua langkah.'), true);
  assert.equal(looksLikeUserAction('Pelaku dapat membuka WhatsApp dari perangkat lain.'), false);
  assert.equal(looksLikeUserAction('Aplikasi pihak ketiga dapat membuka akses akun.'), false);
});

test('audit role fail-closed bila invalid array hilang', async () => {
  let calls = 0;
  const client = { chat: { completions: { async create() {
    calls += 1;
    return { choices: [{ message: { content: JSON.stringify({ formatFit: true }) } }] };
  } } } };

  await assert.rejects(() => auditRoles(client, baseContent([
    { section: 'MASALAH', title: 'Masalah', body: 'Risiko akun perlu diperiksa secara teliti oleh pengguna WhatsApp.', points: [], claims: [] },
    { section: 'SOLUSI', title: 'Periksa akses', body: 'Pengguna dapat memeriksa perangkat tertaut pada akun WhatsApp.', points: [], claims: [] },
    { section: 'SOLUSI', title: 'Aktifkan verifikasi', body: 'Pengguna dapat mengaktifkan verifikasi dua langkah pada akun WhatsApp.', points: [], claims: [] },
    { section: 'PENUTUP', title: 'Ringkasan', body: 'Gunakan fitur keamanan yang memang tersedia pada akun WhatsApp.', points: [], claims: [] }
  ]), [], 'Masalah dan solusi'), error => error?.status === 422 && /tidak boleh dianggap valid tanpa audit/i.test(error.message));
  assert.equal(calls, MAX_ROLE_AUDIT_ATTEMPTS);
});

test('final quality recovery menghasilkan 5 slide padat, dua SOLUSI nyata, source-backed, dan tidak generik', async () => {
  const intro = 'WhatsApp menyimpan percakapan dan informasi akun yang perlu dikelola dengan pengaturan privasi serta keamanan yang tersedia.';
  const problem = 'Aplikasi WhatsApp tidak resmi dapat meningkatkan risiko kebocoran data dan membahayakan informasi pribadi pengguna.';
  const verify = 'Pengguna dapat mengaktifkan verifikasi dua langkah untuk menambahkan lapisan keamanan pada akun WhatsApp.';
  const linked = 'Pengguna dapat memeriksa perangkat tertaut lalu mengeluarkan perangkat yang tidak dikenal dari akun WhatsApp.';
  const privacy = 'Pengguna dapat membatasi siapa yang dapat melihat informasi akun melalui pengaturan privasi WhatsApp.';
  const sources = [{ url: 'https://example.test/whatsapp', text: [intro, problem, verify, linked, privacy].join(' ') }];

  const generated = baseContent([
    { section: 'INTRO', title: 'Kenapa keamanan WhatsApp penting?', body: 'Data pribadi di chat perlu diperhatikan.', points: [], claims: [] },
    { section: 'MASALAH', title: 'Ancaman umum pada WhatsApp', body: problem, points: [], claims: [claim('slide:1:body', problem, problem)] },
    { section: 'PENYEBAB', title: 'Mengapa akun mudah diretas', body: 'Batasan keamanan lokal harus diaktifkan secara manual.', points: [], claims: [] },
    { section: 'SOLUSI', title: 'Langkah mudah lindungi akun', body: 'Multi-Device memungkinkan beberapa perangkat pendamping.', points: [], claims: [] },
    { section: 'PENUTUP', title: 'Kesimpulan', body: 'Dengan langkah sederhana, chat tetap aman dan kamu bebas berinteraksi.', points: [], claims: [] }
  ]);

  const repairedSlides = [
    {
      section: 'INTRO', title: 'Kelola privasi dan keamanan WhatsApp', body: intro,
      points: ['Gunakan pengaturan yang tersedia'],
      claims: [claim('slide:0:title', 'Kelola privasi dan keamanan WhatsApp', intro), claim('slide:0:body', intro, intro), claim('slide:0:point:0', 'Gunakan pengaturan yang tersedia', intro)]
    },
    {
      section: 'MASALAH', title: 'Waspadai aplikasi WhatsApp tidak resmi', body: problem,
      points: ['Risiko kebocoran data meningkat'],
      claims: [claim('slide:1:title', 'Waspadai aplikasi WhatsApp tidak resmi', problem), claim('slide:1:body', problem, problem), claim('slide:1:point:0', 'Risiko kebocoran data meningkat', problem)]
    },
    {
      section: 'SOLUSI', title: 'Aktifkan verifikasi dua langkah', body: verify,
      points: ['Tambahkan lapisan keamanan akun'],
      claims: [claim('slide:2:title', 'Aktifkan verifikasi dua langkah', verify), claim('slide:2:body', verify, verify), claim('slide:2:point:0', 'Tambahkan lapisan keamanan akun', verify)]
    },
    {
      section: 'SOLUSI', title: 'Periksa perangkat yang tertaut', body: linked,
      points: ['Keluarkan perangkat tidak dikenal'],
      claims: [claim('slide:3:title', 'Periksa perangkat yang tertaut', linked), claim('slide:3:body', linked, linked), claim('slide:3:point:0', 'Keluarkan perangkat tidak dikenal', linked)]
    },
    {
      section: 'PENUTUP', title: 'Batasi informasi akun yang terlihat', body: privacy,
      points: ['Atur siapa yang dapat melihat'],
      claims: [claim('slide:4:title', 'Batasi informasi akun yang terlihat', privacy), claim('slide:4:body', privacy, privacy), claim('slide:4:point:0', 'Atur siapa yang dapat melihat', privacy)]
    }
  ];

  let auditCalls = 0;
  let recoveryCalls = 0;
  let semanticCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/AUDIT PERAN FORMAT/i.test(prompt)) {
      auditCalls += 1;
      if (auditCalls === 1) return { choices: [{ message: { content: JSON.stringify({
        formatFit: true,
        invalid: [
          { slideIndex: 2, role: 'SOLUSI', reason: 'PENYEBAB harus diganti solusi pengguna yang didukung sumber.' },
          { slideIndex: 3, role: 'SOLUSI', reason: 'Body hanya menjelaskan fitur Multi-Device.' }
        ]
      }) } }] };
      return { choices: [{ message: { content: JSON.stringify({ formatFit: true, invalid: [] }) } }] };
    }
    if (/PERBAIKAN FINAL QUALITY/i.test(prompt)) {
      recoveryCalls += 1;
      assert.match(prompt, /18–32 kata substantif/i);
      assert.match(prompt, /title juga wajib punya claim field/i);
      assert.match(prompt, /Informasi fitur atau kemampuan produk tidak boleh disamarkan menjadi SOLUSI/i);
      return { choices: [{ message: { content: JSON.stringify({ slides: repairedSlides }) } }] };
    }
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      semanticCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    throw new Error(`Unexpected AI call: ${prompt.slice(0, 100)}`);
  } } } };

  const result = await repairManualSourceRoles({
    contentService: { validateContent() { return []; } },
    generated,
    options: { topicSource: 'manual', useSources: true, requestedTopic: 'Keamanan WhatsApp', contentFormat: 'Masalah dan solusi' },
    sources,
    client
  });

  assert.equal(recoveryCalls, 1);
  assert.ok(auditCalls >= 2, 'hasil akhir harus diaudit ulang');
  assert.equal(semanticCalls, 1, 'hasil final wajib semantic audit');
  assert.deepEqual(result.slides.map(slide => slide.section), ['INTRO', 'MASALAH', 'SOLUSI', 'SOLUSI', 'PENUTUP']);
  assert.equal(contentDensityErrors(result, sources[0].text.split('. ').filter(Boolean).map(evidence => ({ sourceId: 'source-1', evidence }))).filter(error => /isi terlalu tipis/.test(error)).length, 0);
  assert.equal(deterministicRoleErrors(result, 'Masalah dan solusi').length, 0);
});
