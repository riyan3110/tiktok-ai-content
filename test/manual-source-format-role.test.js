const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  repairManualSourceDuplicates,
  manualTutorialRoleErrors,
  looksLikeUserAction,
  effectiveManualFormat
} = require('../src/services/manualSourceDedupe');

function claim(field, text, evidence) {
  return { field, text, sourceId: 'source-1', evidence };
}

function baseContent(slides, topic = 'Tanda WhatsApp disadap') {
  return {
    focus: { masalah: 'Risiko akses akun', penyebab: 'Akses tidak dikenal', solusi: 'Periksa sumber', hasil: 'Pahami risikonya' },
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

test('detektor peran menolak metode pelaku yang dilabeli LANGKAH dan hasil palsu', () => {
  const slides = [
    { section: 'PEMBUKA', title: 'Tanda WhatsApp Anda Disadap', body: 'Kode OTP tanpa permintaan perlu diperhatikan.', points: [], claims: [] },
    { section: 'LANGKAH 1', title: 'Aplikasi Pihak Ketiga Dapat Digunakan', body: 'Pelaku dapat memanfaatkan aplikasi pihak ketiga untuk mengakses WhatsApp Anda.', points: [], claims: [] },
    { section: 'LANGKAH 2', title: 'Akses WhatsApp Web dari Perangkat Lain', body: 'Penggunaan WhatsApp Web pada perangkat tidak dikenal dapat menjadi jalur penyadapan.', points: [], claims: [] },
    { section: 'HASIL/PENUTUP', title: 'Waspadai Penyadapan WhatsApp', body: 'Penyadapan dapat terjadi melalui berbagai cara, sehingga penting meningkatkan keamanan.', points: [], claims: [] }
  ];

  assert.deepEqual(manualTutorialRoleErrors({ slides }, 'Tutorial langkah'), [
    'slide:1:role: LANGKAH harus berisi tindakan konkret yang dilakukan pengguna, bukan tanda, risiko, kemampuan pelaku, atau mekanisme serangan.',
    'slide:2:role: LANGKAH harus berisi tindakan konkret yang dilakukan pengguna, bukan tanda, risiko, kemampuan pelaku, atau mekanisme serangan.',
    'slide:3:role: HASIL/PENUTUP tidak boleh disebut hasil ketika langkah sebelumnya bukan tindakan pengguna yang valid.'
  ]);
});

test('detektor menerima tindakan yang benar-benar dilakukan pengguna', () => {
  assert.equal(looksLikeUserAction('Periksa perangkat tertaut di pengaturan WhatsApp.'), true);
  assert.equal(looksLikeUserAction('Pengguna dapat mengeluarkan perangkat yang tidak dikenal.'), true);
  assert.equal(looksLikeUserAction('Pelaku dapat memanfaatkan aplikasi pihak ketiga.'), false);
  assert.equal(looksLikeUserAction('Penggunaan WhatsApp Web dapat menjadi jalur akses.'), false);
});

test('Manual + URL turun ke struktur fakta jika source tidak menyediakan dua langkah pengguna', async () => {
  const facts = [
    'Kode OTP tanpa permintaan pengguna dapat menjadi tanda percobaan akses ke akun WhatsApp.',
    'Aplikasi pihak ketiga dapat digunakan pelaku untuk mengakses akun WhatsApp korban.',
    'WhatsApp Web pada perangkat yang tidak dikenal dapat membuka akses ke akun yang tertaut.',
    'Akses tidak sah ke akun WhatsApp dapat terjadi melalui lebih dari satu jalur.'
  ];
  const generated = baseContent([
    {
      section: 'PEMBUKA', title: 'Tanda Akses Tidak Dikenal', body: facts[0], points: [],
      claims: [claim('slide:0:body', facts[0], facts[0])]
    },
    {
      section: 'LANGKAH 1', title: 'Aplikasi Pihak Ketiga', body: facts[1], points: [],
      claims: [claim('slide:1:body', facts[1], facts[1])]
    },
    {
      section: 'LANGKAH 2', title: 'WhatsApp Web Tidak Dikenal', body: facts[2], points: [],
      claims: [claim('slide:2:body', facts[2], facts[2])]
    },
    {
      section: 'HASIL/PENUTUP', title: 'Waspadai Berbagai Jalur Akses', body: facts[3], points: [],
      claims: [claim('slide:3:body', facts[3], facts[3])]
    }
  ]);

  let roleAuditCalls = 0;
  let roleRepairCalls = 0;
  let semanticAuditCalls = 0;
  const repairedSlides = [
    generated.slides[0],
    {
      section: 'FAKTA UTAMA', title: 'Aplikasi Pihak Ketiga', body: facts[1], points: [],
      claims: [claim('slide:1:body', facts[1], facts[1])]
    },
    {
      section: 'PENJELASAN', title: 'WhatsApp Web Tidak Dikenal', body: facts[2], points: [],
      claims: [claim('slide:2:body', facts[2], facts[2])]
    },
    {
      section: 'KESIMPULAN', title: 'Lebih dari Satu Jalur Akses', body: facts[3], points: [],
      claims: [claim('slide:3:body', facts[3], facts[3])]
    }
  ];

  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/AUDIT PERAN FORMAT/i.test(prompt)) {
      roleAuditCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({
        tutorialFit: false,
        invalid: [
          { slideIndex: 1, role: 'LANGKAH', reason: 'Menjelaskan tindakan pelaku.' },
          { slideIndex: 2, role: 'LANGKAH', reason: 'Menjelaskan jalur akses, bukan tindakan pengguna.' },
          { slideIndex: 3, role: 'HASIL', reason: 'Bukan outcome dari langkah pengguna.' }
        ]
      }) } }] };
    }
    if (/PERBAIKAN PERAN FORMAT/i.test(prompt)) {
      roleRepairCalls += 1;
      assert.match(prompt, /DILARANG mengarang langkah/i);
      assert.match(prompt, /FAKTA UTAMA/);
      return { choices: [{ message: { content: JSON.stringify({ slides: repairedSlides }) } }] };
    }
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      semanticAuditCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    throw new Error(`Unexpected AI call: ${prompt.slice(0, 80)}`);
  } } } };

  const result = await repairManualSourceDuplicates({
    contentService: { validateContent() { return []; } },
    generated,
    options: {
      topicSource: 'manual', useSources: true,
      requestedTopic: 'Tanda WhatsApp disadap', contentFormat: 'Tutorial langkah'
    },
    sources: [{ url: 'https://example.test/whatsapp', text: facts.join(' ') }],
    client
  });

  assert.equal(roleAuditCalls, 1);
  assert.equal(roleRepairCalls, 1);
  assert.equal(semanticAuditCalls, 1);
  assert.deepEqual(result.slides.map(slide => slide.section), ['PEMBUKA', 'FAKTA UTAMA', 'PENJELASAN', 'KESIMPULAN']);
  assert.equal(result.slides[0].title, generated.slides[0].title, 'pembuka yang sudah valid tetap terkunci');
  assert.equal(result.slides[1].body, facts[1]);
  assert.equal(result.slides[2].body, facts[2]);
  assert.equal(result.slides[3].body, facts[3]);
  assert.equal(effectiveManualFormat(result, 'Tutorial langkah'), 'Fakta singkat');
});

test('tutorial source-backed yang benar tetap dipertahankan tanpa rewrite', async () => {
  const facts = [
    'Pengguna dapat memeriksa perangkat tertaut dari pengaturan akun WhatsApp.',
    'Pengguna dapat mengeluarkan perangkat yang tidak dikenal dari daftar perangkat tertaut.',
    'Mengeluarkan perangkat yang tidak dikenal akan mengakhiri sesi pada perangkat tersebut.'
  ];
  const generated = baseContent([
    { section: 'PEMBUKA', title: 'Periksa Akses Akun', body: 'Perangkat tertaut dapat ditinjau dari pengaturan akun.', points: [], claims: [] },
    { section: 'LANGKAH 1', title: 'Periksa Perangkat Tertaut', body: facts[0], points: [], claims: [claim('slide:1:body', facts[0], facts[0])] },
    { section: 'LANGKAH 2', title: 'Keluarkan Perangkat Asing', body: facts[1], points: [], claims: [claim('slide:2:body', facts[1], facts[1])] },
    { section: 'HASIL/PENUTUP', title: 'Sesi Asing Berakhir', body: facts[2], points: [], claims: [claim('slide:3:body', facts[2], facts[2])] }
  ], 'Periksa perangkat tertaut WhatsApp');

  let roleAuditCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/AUDIT PERAN FORMAT/i.test(prompt)) {
      roleAuditCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ tutorialFit: true, invalid: [] }) } }] };
    }
    throw new Error('Tutorial valid tidak boleh menjalankan rewrite atau semantic audit tambahan.');
  } } } };

  const result = await repairManualSourceDuplicates({
    contentService: { validateContent() { return []; } },
    generated,
    options: {
      topicSource: 'manual', useSources: true,
      requestedTopic: 'Periksa perangkat tertaut WhatsApp', contentFormat: 'Tutorial langkah'
    },
    sources: [{ url: 'https://example.test/actions', text: facts.join(' ') }],
    client
  });

  assert.equal(roleAuditCalls, 1);
  assert.deepEqual(result.slides, generated.slides);
});

test('HASIL yang tidak sesuai dapat diturunkan menjadi PENUTUP tanpa mengubah langkah valid', async () => {
  const facts = [
    'Pengguna dapat memeriksa perangkat tertaut dari pengaturan akun WhatsApp.',
    'Pengguna dapat mengeluarkan perangkat yang tidak dikenal dari daftar perangkat tertaut.',
    'Perangkat tertaut menampilkan sesi yang sedang terhubung ke akun WhatsApp.'
  ];
  const generated = baseContent([
    { section: 'PEMBUKA', title: 'Periksa Akses Akun', body: 'Cek perangkat yang terhubung ke akun.', points: [], claims: [] },
    { section: 'LANGKAH 1', title: 'Periksa Perangkat Tertaut', body: facts[0], points: [], claims: [claim('slide:1:body', facts[0], facts[0])] },
    { section: 'LANGKAH 2', title: 'Keluarkan Perangkat Asing', body: facts[1], points: [], claims: [claim('slide:2:body', facts[1], facts[1])] },
    { section: 'HASIL/PENUTUP', title: 'Keamanan Pasti Meningkat', body: 'Langkah ini pasti meningkatkan keamanan akun.', points: [], claims: [] }
  ], 'Periksa perangkat tertaut WhatsApp');

  let roleAuditCalls = 0;
  let roleRepairCalls = 0;
  let semanticAuditCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/AUDIT PERAN FORMAT/i.test(prompt)) {
      roleAuditCalls += 1;
      if (roleAuditCalls === 1) return { choices: [{ message: { content: JSON.stringify({
        tutorialFit: true,
        invalid: [{ slideIndex: 3, role: 'HASIL', reason: 'Outcome tidak didukung source.' }]
      }) } }] };
      return { choices: [{ message: { content: JSON.stringify({ tutorialFit: true, invalid: [] }) } }] };
    }
    if (/PERBAIKAN PERAN FORMAT/i.test(prompt)) {
      roleRepairCalls += 1;
      const slides = [
        generated.slides[0], generated.slides[1], generated.slides[2],
        {
          section: 'PENUTUP', title: 'Cek Sesi yang Masih Terhubung', body: facts[2], points: [],
          claims: [claim('slide:3:body', facts[2], facts[2])]
        }
      ];
      return { choices: [{ message: { content: JSON.stringify({ slides }) } }] };
    }
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      semanticAuditCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    throw new Error('Unexpected call');
  } } } };

  const result = await repairManualSourceDuplicates({
    contentService: { validateContent() { return []; } },
    generated,
    options: {
      topicSource: 'manual', useSources: true,
      requestedTopic: 'Periksa perangkat tertaut WhatsApp', contentFormat: 'Tutorial langkah'
    },
    sources: [{ url: 'https://example.test/outcome', text: facts.join(' ') }],
    client
  });

  assert.equal(roleRepairCalls, 1);
  assert.equal(semanticAuditCalls, 1);
  assert.equal(result.slides[1].body, generated.slides[1].body, 'LANGKAH 1 tetap terkunci');
  assert.equal(result.slides[2].body, generated.slides[2].body, 'LANGKAH 2 tetap terkunci');
  assert.equal(result.slides[3].section, 'PENUTUP');
  assert.equal(result.slides[3].body, facts[2]);
});
