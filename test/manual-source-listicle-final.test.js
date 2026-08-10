const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  repairManualSourceRoles,
  deterministicRoleErrors,
  contentDensityErrors,
  effectiveManualFormat,
  extractManualFactBank,
  looksLikeUserAction
} = require('../src/services/manualSourceRoleGuard');

function claim(field, text, evidence) {
  return { field, text, sourceId: 'source-1', evidence };
}

function badBeautynesiaLikeDraft() {
  const slides = [
    { section: 'PEMBUKA', title: 'Mengenal Daya Ingat', body: 'Otak memproses dan menyimpan informasi dalam berbagai tahap.', points: [], claims: [] },
    { section: 'FAKTA UTAMA', title: 'Faktor yang Mempengaruhi Memori', body: 'Konsumsi buah sebaiknya dilakukan sebelum atau sesudah makan.', points: [], claims: [] },
    { section: 'KONTEKS', title: 'Peran Nutrisi dalam Kesehatan Otak', body: '5 buah ini dapat membantu menurunkan asam urat secara alami.', points: [], claims: [] },
    { section: 'KESIMPULAN', title: 'Tips meningkatkan ingatan', body: '8 buah dapat membantu membakar lemak perut dalam sebulan.', points: [], claims: [] }
  ];
  return {
    focus: { masalah: 'Daya ingat', penyebab: 'Nutrisi', solusi: 'Pilih fakta sumber', hasil: 'Ringkasan' },
    topic: 'Daya ingat', hook: slides[0].title, body: slides[0].body, caption: slides[0].body,
    hashtags: [], cta: slides.at(-1).title, trendKeywordsUsed: [], content_angle: 'buah dan daya ingat',
    primary_tool: 'tanpa tool', hook_pattern: 'listicle', verificationStatus: 'source_based', unsupportedClaims: [], slides
  };
}

test('Listicle menangkap struktur fallback, slide tipis, dan coverage rendah', () => {
  const draft = badBeautynesiaLikeDraft();
  const bank = Array.from({ length: 5 }, (_, index) => ({
    sourceId: 'source-1', evidence: `Buah nomor ${index + 1} dibahas sebagai bagian berbeda dalam artikel utama mengenai nutrisi dan daya ingat.`
  }));
  assert.ok(deterministicRoleErrors(draft, 'Listicle').some(error => /Listicle tidak boleh diam-diam berubah/i.test(error)));
  const density = contentDensityErrors(draft, bank);
  for (let index = 0; index < 4; index += 1) assert.ok(density.some(error => error.startsWith(`slide:${index}:density:`)));
  assert.ok(density.some(error => /^coverage:density:/.test(error)));
  assert.equal(effectiveManualFormat({ ...draft, effectiveContentFormat: 'Fakta singkat' }, 'Listicle'), 'Listicle', 'model tidak boleh override format pengguna');
});

test('detektor aksi menerima bentuk kata kerja Indonesia berimbuhan', () => {
  for (const text of [
    'Pengguna dapat menghapus perangkat yang tidak dikenal.',
    'Setelah itu, mengeluarkan sesi asing dari akun.',
    'Gunakan menu ini untuk menggunakan pengaturan resmi.',
    'Pengguna dapat mengubah dan mengatur pilihan keamanan.',
    'Pengguna dapat membatasi informasi akun yang terlihat.',
    'Pengguna dapat menyimpan pengaturan setelah selesai.'
  ]) assert.equal(looksLikeUserAction(text), true, text);
});

test('FACT_BANK manual mempertahankan fakta privasi yang substantif tetapi membuang privacy-policy boilerplate', () => {
  const sources = [{
    title: 'Cara mengatur privasi WhatsApp',
    text: [
      'Pengguna dapat membatasi siapa yang melihat informasi akun melalui pengaturan privasi WhatsApp.',
      'Kebijakan privasi situs ini menjelaskan penggunaan cookie dan ketentuan layanan.',
      'Pengguna dapat memeriksa perangkat tertaut dari menu pengaturan akun WhatsApp.'
    ].join(' ')
  }];
  const bank = extractManualFactBank(sources, 'privasi WhatsApp');
  assert.ok(bank.some(fact => /pengaturan privasi WhatsApp/i.test(fact.evidence)));
  assert.ok(bank.some(fact => /perangkat tertaut/i.test(fact.evidence)));
  assert.equal(bank.some(fact => /Kebijakan privasi situs/i.test(fact.evidence)), false);
});

test('final all-format gate membangun ulang kasus Beautynesia menjadi 5 ITEM padat dan hanya fakta artikel utama', async () => {
  const facts = [
    'Apel mengandung antioksidan dan dibahas sebagai salah satu buah yang mendukung kesehatan otak dalam artikel utama.',
    'Alpukat mengandung lemak tak jenuh dan nutrisi yang dibahas berkaitan dengan fungsi otak dalam artikel utama.',
    'Buah beri mengandung antioksidan dan dibahas dalam artikel sebagai salah satu pilihan buah untuk kesehatan otak.',
    'Pisang mengandung vitamin dan mineral yang dibahas sebagai bagian dari daftar buah dalam artikel utama.',
    'Jambu biji mengandung vitamin C dan dibahas sebagai buah terakhir dalam daftar utama mengenai kesehatan otak.'
  ];
  const source = {
    url: 'https://example.test/daya-ingat',
    title: '5 Daftar Buah yang Dapat Meningkatkan Daya Ingat',
    text: facts.join(' ')
  };
  const repairedSlides = facts.map((evidence, index) => {
    const names = ['Apel', 'Alpukat', 'Buah Beri', 'Pisang', 'Jambu Biji'];
    const point = ['Antioksidan menjadi poin utama', 'Lemak tak jenuh ikut dibahas', 'Antioksidan kembali menjadi sorotan', 'Vitamin dan mineral ikut dibahas', 'Vitamin C menjadi kandungan utama'][index];
    return {
      section: `ITEM ${index + 1}`,
      title: names[index],
      body: evidence,
      points: [point],
      claims: [claim(`slide:${index}:body`, evidence, evidence), claim(`slide:${index}:point:0`, point, evidence)]
    };
  });

  let auditCalls = 0;
  let rebuildCalls = 0;
  let semanticCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/AUDIT PERAN FORMAT/i.test(prompt)) {
      auditCalls += 1;
      if (auditCalls === 1) return { choices: [{ message: { content: JSON.stringify({
        formatFit: true,
        invalid: [
          { slideIndex: 0, reason: 'Bukan ITEM Listicle dan terlalu umum.' },
          { slideIndex: 2, reason: 'Asam urat adalah related-content di luar artikel utama.' },
          { slideIndex: 3, reason: 'Lemak perut adalah related-content di luar artikel utama.' }
        ]
      }) } }] };
      return { choices: [{ message: { content: JSON.stringify({ formatFit: true, invalid: [] }) } }] };
    }
    if (/PERBAIKAN FINAL QUALITY/i.test(prompt)) {
      rebuildCalls += 1;
      assert.match(prompt, /FORMAT WAJIB: "Listicle"/);
      assert.match(prompt, /18–32 kata substantif/i);
      assert.match(prompt, /artikel terkait, Baca Juga, rekomendasi, sidebar, teaser/i);
      assert.match(prompt, /ITEM 1\.\.N/i);
      return { choices: [{ message: { content: JSON.stringify({ slides: repairedSlides }) } }] };
    }
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      semanticCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    throw new Error(`Unexpected AI call: ${prompt.slice(0, 120)}`);
  } } } };

  const result = await repairManualSourceRoles({
    contentService: { validateContent() { return []; } },
    generated: badBeautynesiaLikeDraft(),
    options: { topicSource: 'manual', useSources: true, requestedTopic: 'Daya ingat', contentFormat: 'Listicle' },
    sources: [source], client
  });

  assert.equal(rebuildCalls, 1);
  assert.ok(auditCalls >= 2, 'hasil final harus diaudit ulang');
  assert.equal(semanticCalls, 1, 'hasil final harus semantic-audit');
  assert.deepEqual(result.slides.map(slide => slide.section), ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4', 'ITEM 5']);
  assert.equal(result.slides.some(slide => /asam urat|lemak perut/i.test(`${slide.title} ${slide.body} ${(slide.points || []).join(' ')}`)), false);
  const bank = extractManualFactBank([source], 'Daya ingat');
  assert.equal(contentDensityErrors(result, bank).filter(error => /isi terlalu tipis/.test(error)).length, 0);
  assert.equal(deterministicRoleErrors(result, 'Listicle').length, 0);
});

test('fallback format tetap sticky selama repair lanjutan dan tidak kembali ke Tutorial', async () => {
  const facts = [
    'Sumber menjelaskan fakta pertama yang relevan secara langsung dengan topik utama dan memiliki konteks yang cukup lengkap.',
    'Sumber menjelaskan fakta kedua yang berbeda dari fakta pertama dan tetap berkaitan langsung dengan topik utama.',
    'Sumber menjelaskan fakta ketiga sebagai konteks tambahan yang berbeda dan masih relevan terhadap topik utama.',
    'Sumber menjelaskan fakta keempat sebagai ringkasan penting yang tetap berasal dari artikel utama yang sama.'
  ];
  const source = { url: 'https://example.test/fakta', title: 'Artikel fakta utama', text: facts.join(' ') };
  const generated = {
    ...badBeautynesiaLikeDraft(),
    topic: 'Topik fakta',
    slides: [
      { section: 'PEMBUKA', title: 'Pembuka', body: '', points: [], claims: [] },
      { section: 'LANGKAH 1', title: 'Langkah satu', body: 'Sumber tidak memberi tindakan pengguna.', points: [], claims: [] },
      { section: 'LANGKAH 2', title: 'Langkah dua', body: 'Sumber juga tidak memberi tindakan pengguna.', points: [], claims: [] },
      { section: 'HASIL/PENUTUP', title: 'Hasil', body: '', points: [], claims: [] }
    ]
  };
  const thinFallback = facts.map((evidence, index) => ({
    section: ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'][index],
    title: `Fakta ${index + 1}`, body: 'Isi terlalu singkat.', points: [], claims: []
  }));
  const denseFallback = facts.map((evidence, index) => ({
    section: ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'][index],
    title: `Fakta ${index + 1}`, body: evidence,
    points: ['Berasal dari artikel utama'],
    claims: [claim(`slide:${index}:body`, evidence, evidence), claim(`slide:${index}:point:0`, 'Berasal dari artikel utama', evidence)]
  }));

  let auditCalls = 0;
  let rebuildCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/AUDIT PERAN FORMAT/i.test(prompt)) {
      auditCalls += 1;
      if (auditCalls === 1) return { choices: [{ message: { content: JSON.stringify({
        formatFit: false, invalid: [{ slideIndex: 1, reason: 'Sumber tidak menyediakan tutorial tindakan pengguna.' }]
      }) } }] };
      assert.match(prompt, /FORMAT: "Fakta singkat"/);
      return { choices: [{ message: { content: JSON.stringify({ formatFit: true, invalid: [] }) } }] };
    }
    if (/PERBAIKAN FINAL QUALITY/i.test(prompt)) {
      rebuildCalls += 1;
      assert.match(prompt, /FORMAT WAJIB: "Fakta singkat"/);
      assert.doesNotMatch(prompt, /FORMAT WAJIB: "Tutorial langkah"/);
      return { choices: [{ message: { content: JSON.stringify({ slides: rebuildCalls === 1 ? thinFallback : denseFallback }) } }] };
    }
    if (/auditor entailment fakta bilingual/i.test(prompt)) return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    throw new Error(`Unexpected call: ${prompt.slice(0, 100)}`);
  } } } };

  const result = await repairManualSourceRoles({
    contentService: { validateContent() { return []; } }, generated,
    options: { topicSource: 'manual', useSources: true, requestedTopic: 'Topik fakta', contentFormat: 'Tutorial langkah' },
    sources: [source], client
  });

  assert.equal(rebuildCalls, 2, 'fallback yang masih tipis diperbaiki lagi tanpa kembali ke Tutorial');
  assert.equal(result.effectiveContentFormat, 'Fakta singkat');
  assert.deepEqual(result.slides.map(slide => slide.section), ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN']);
});
