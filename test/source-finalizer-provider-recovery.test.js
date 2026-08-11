const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const sourceFilter = require('../src/services/sourceFilter');
const finalizer = require('../src/services/sourceUrlFinalizer');

function englishSource() {
  return [{
    url: 'https://example.test/atlas-device',
    finalUrl: 'https://example.test/atlas-device',
    title: 'Atlas Device Profile Study',
    text: [
      'The Atlas device supports local profiles for shared workstations.',
      'Administrators can disable background synchronization when required.',
      'The device stores preferences locally between work sessions.',
      'Operators may export configuration records for later review.',
      'The control panel shows profile status without opening another screen.',
      'The team plans to publish migration guidance next quarter.',
      'Tests associated the cache setting with shorter startup time.',
      'The device can reduce memory use when several panels remain open.'
    ].join(' ')
  }];
}

function candidate(format = 'Fakta singkat', firstBody = 'Perangkat Atlas mendukung profil lokal untuk workstation yang digunakan bersama.') {
  const sections = format === 'Listicle'
    ? ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4']
    : ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'];
  const rows = [
    [firstBody, 'Profil lokal tersedia untuk workstation', 'The Atlas device supports local profiles for shared workstations.', 'Sinkronisasi latar dapat dinonaktifkan', 'Administrators can disable background synchronization when required.'],
    ['Perangkat menyimpan preferensi secara lokal di antara sesi kerja pengguna.', 'Catatan konfigurasi dapat diekspor', 'The device stores preferences locally between work sessions.', 'Ekspor tersedia untuk peninjauan', 'Operators may export configuration records for later review.'],
    ['Panel kontrol menampilkan status profil tanpa perlu membuka layar lainnya.', 'Status terlihat pada panel kontrol', 'The control panel shows profile status without opening another screen.', 'Panduan migrasi masih direncanakan', 'The team plans to publish migration guidance next quarter.'],
    ['Pengujian mengaitkan pengaturan cache dengan waktu mulai yang lebih singkat.', 'Memori dapat berkurang saat panel terbuka', 'Tests associated the cache setting with shorter startup time.', 'Penggunaan memori dapat dikurangi', 'The device can reduce memory use when several panels remain open.']
  ];
  const slides = rows.map((row, index) => ({
    section: sections[index],
    title: ['Profil Lokal Atlas', 'Preferensi Tetap Tersimpan', 'Status Mudah Dilihat', 'Cache dan Waktu Mulai'][index],
    body: row[0],
    points: [row[1]],
    claims: [
      { field: `slide:${index}:body`, text: row[0], sourceId: 'source-1', evidence: row[2] },
      { field: `slide:${index}:point:0`, text: row[1], sourceId: 'source-1', evidence: row[4] }
    ]
  }));
  return {
    topic: 'Atlas Device', effectiveContentFormat: format,
    hook: slides[0].title, body: slides[1].body, caption: slides[1].body,
    cta: slides.at(-1).title, hashtags: [], verificationStatus: 'source_based', slides
  };
}

function responseFor(content) {
  return { choices: [{ message: { content: JSON.stringify({ slides: content.slides }) } }] };
}

function clientWith(responses) {
  let calls = 0;
  return {
    get calls() { return calls; },
    chat: { completions: { create: async () => {
      const response = responses[Math.min(calls, responses.length - 1)];
      calls += 1;
      return response;
    } } }
  };
}

async function withoutSemanticProvider(t) {
  const original = sourceFilter.auditClaimSemantics;
  sourceFilter.auditClaimSemantics = async () => [];
  t.after(() => { sourceFilter.auditClaimSemantics = original; });
}

for (const format of ['Fakta singkat', 'Listicle']) {
  test(`${format}: provider valid pada request pertama menghasilkan candidate grounded`, async t => {
    await withoutSemanticProvider(t);
    const valid = candidate(format);
    const client = clientWith([responseFor(valid)]);
    const result = await finalizer.rewriteAllSourcesWithAi({
      generated: valid, sources: englishSource(), topic: 'Atlas Device', format, client
    });
    assert.deepEqual(result.slides, valid.slides);
    assert.ok(client.calls >= 1 && client.calls <= finalizer.MAX_FINALIZE_ATTEMPTS);
  });

  test(`${format}: response kosong pertama pulih dengan fresh response valid kedua`, async t => {
    await withoutSemanticProvider(t);
    const valid = candidate(format);
    const client = clientWith([
      { choices: [{ message: { content: '' } }] },
      responseFor(valid)
    ]);
    const result = await finalizer.rewriteAllSourcesWithAi({
      generated: valid, sources: englishSource(), topic: 'Atlas Device', format, client
    });
    assert.equal(client.calls, 2);
    assert.deepEqual(result.slides, valid.slides);
  });
}

test('fenced JSON valid dinormalisasi secara terbatas', () => {
  const valid = candidate();
  const response = { choices: [{ message: { content: `\n\`\`\`json\n${JSON.stringify({ slides: valid.slides })}\n\`\`\`\n` } }] };
  assert.deepEqual(finalizer.parseSlides(response, valid.slides.map(slide => slide.section)), valid.slides);
});

test('content array text valid dinormalisasi secara terbatas', () => {
  const valid = candidate();
  const response = { choices: [{ message: { content: [{ type: 'text', text: JSON.stringify({ slides: valid.slides }) }] } }] };
  assert.deepEqual(finalizer.parseSlides(response, valid.slides.map(slide => slide.section)), valid.slides);
});

test('object JSON yang sudah parsed diterima hanya bila shape slides valid', () => {
  const valid = candidate();
  const response = { choices: [{ message: { content: { slides: valid.slides } } }] };
  assert.deepEqual(finalizer.parseSlides(response, valid.slides.map(slide => slide.section)), valid.slides);
  assert.throws(
    () => finalizer.parseSlides({ choices: [{ message: { content: { unexpected: true } } }] }, valid.slides.map(slide => slide.section)),
    /jumlah slide|shape|slides/i
  );
});

test('malformed fenced JSON pertama pulih dengan response valid kedua', async t => {
  await withoutSemanticProvider(t);
  const valid = candidate();
  const client = clientWith([
    { choices: [{ message: { content: '```json\n{"slides": [ broken\n```' } }] },
    responseFor(valid)
  ]);
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: valid, sources: englishSource(), topic: 'Atlas Device', format: 'Fakta singkat', client
  });
  assert.equal(client.calls, 2);
  assert.deepEqual(result.slides, valid.slides);
});

test('semua response kosong atau malformed berhenti tepat pada bounded limit', async t => {
  await withoutSemanticProvider(t);
  const valid = candidate();
  const client = clientWith([
    { choices: [{ message: { content: '' } }] },
    { choices: [{ message: { content: '```json\n{"slides": [' } }] },
    { choices: [{ message: { content: '   ' } }] }
  ]);
  await assert.rejects(
    finalizer.rewriteAllSourcesWithAi({ generated: valid, sources: englishSource(), topic: 'Atlas Device', format: 'Fakta singkat', client }),
    error => error.status === 422
      && /provider output invalid/i.test(error.message)
      && Array.isArray(error.validationErrors)
  );
  assert.equal(client.calls, finalizer.MAX_FINALIZE_ATTEMPTS);
});

test('numeric dan ordinal grounding membedakan cardinal dari urutan', () => {
  const checks = [
    ['Perangkat mendukung 14 profil.', 'Perangkat mendukung 14 profil.', true],
    ['Perangkat mendukung 15 profil.', 'Perangkat mendukung 14 profil.', false],
    ['Produk generasi kedua tersedia.', 'Produk ini merupakan generasi kedua.', true],
    ['Produk generasi kedua tersedia.', 'Produk ini tersedia untuk tim internal.', false],
    ['Produk ke-14 perusahaan tersedia.', 'Perusahaan mendukung 14 profil lokal.', false]
  ];
  for (const [text, evidence, valid] of checks) {
    assert.equal(finalizer.numericGroundingErrors({
      slides: [{ title: text, body: '', points: [], claims: [{ field: 'slide:0:title', text, sourceId: 'source-1', evidence }] }]
    }).length === 0, valid, `${text} <> ${evidence}`);
  }
});

for (const format of ['Fakta singkat', 'Listicle']) {
  test(`${format}: angka hallucinated diberi feedback spesifik lalu corrected candidate lolos`, async t => {
    await withoutSemanticProvider(t);
    const invalid = candidate(format, 'Produk ke-14 perusahaan tersebut mendukung profil lokal untuk workstation bersama.');
    invalid.slides[0].claims[0].text = invalid.slides[0].body;
    const valid = candidate(format);
    const prompts = [];
    const client = {
      chat: { completions: { create: async request => {
        prompts.push(request.messages[1].content);
        return prompts.length === 1 ? responseFor(invalid) : responseFor(valid);
      } } }
    };
    const result = await finalizer.rewriteAllSourcesWithAi({
      generated: valid, sources: englishSource(), topic: 'Atlas Device', format, client
    });
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /ordinal|ke-14|angka.*evidence/i);
    assert.equal(result.slides[0].body, valid.slides[0].body);
  });
}
