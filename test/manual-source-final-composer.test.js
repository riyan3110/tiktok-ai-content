const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  composeManualSourceContent,
  extractManualFactBank,
  desiredSlideCount,
  densityErrors,
  claimErrors
} = require('../src/services/manualSourceComposer');

const facts = [
  'Apel mengandung quercetin, antioksidan yang dalam artikel dikaitkan dengan perlindungan sel otak dari stres oksidatif.',
  'Artikel menyebut konsumsi apel bersama kulitnya karena sebagian besar quercetin berada pada bagian kulit buah.',
  'Alpukat mengandung lemak tak jenuh tunggal yang mendukung aliran darah sehat, termasuk aliran darah menuju otak.',
  'Alpukat juga menyediakan vitamin K dan folat yang dibahas dalam artikel dalam konteks fungsi kognitif.',
  'Buah beri seperti blueberry dan stroberi kaya antosianin, yaitu senyawa antioksidan yang memberi warna pada buah.',
  'Artikel mengaitkan antosianin pada buah beri dengan dukungan terhadap komunikasi antarsel di dalam otak.',
  'Pisang mengandung vitamin B6 yang dibutuhkan tubuh untuk membentuk sejumlah neurotransmiter penting.',
  'Artikel menjelaskan neurotransmiter tersebut berperan dalam proses yang berkaitan dengan suasana hati dan fungsi otak.',
  'Jambu biji menyediakan vitamin C dalam jumlah tinggi dan vitamin ini berfungsi sebagai antioksidan di dalam tubuh.',
  'Artikel membahas vitamin C pada jambu biji dalam kaitannya dengan perlindungan sel dari kerusakan akibat radikal bebas.'
];

const source = {
  url: 'https://example.test/daya-ingat',
  finalUrl: 'https://example.test/daya-ingat',
  title: '5 Daftar Buah yang Dapat Meningkatkan Daya Ingat',
  text: [
    ...facts,
    'Baca Juga: 5 buah ini dapat menurunkan asam urat secara alami.',
    'Baca Juga: 8 buah dapat membantu membakar lemak perut dalam sebulan.'
  ].join('\n')
};

function makeSlide(index, title, body, point, evidenceA, evidenceB) {
  return {
    section: `ITEM ${index + 1}`,
    title,
    body,
    points: [point],
    claims: [
      { field: `slide:${index}:title`, text: title, sourceId: 'source-1', evidence: evidenceA },
      { field: `slide:${index}:body`, text: body, sourceId: 'source-1', evidence: evidenceA },
      { field: `slide:${index}:point:0`, text: point, sourceId: 'source-1', evidence: evidenceB }
    ]
  };
}

function richListicle() {
  return {
    topic: 'Daya ingat', hashtags: [], trendKeywordsUsed: [], content_angle: 'buah dan daya ingat',
    primary_tool: 'tanpa tool', hook_pattern: 'listicle source-backed', verificationStatus: 'source_based', unsupportedClaims: [],
    slides: [
      makeSlide(0, 'Apel', 'Apel mengandung quercetin, antioksidan yang dalam artikel dikaitkan dengan perlindungan sel otak dari stres oksidatif.', 'Quercetin banyak terdapat pada kulit', facts[0], facts[1]),
      makeSlide(1, 'Alpukat', 'Alpukat mengandung lemak tak jenuh tunggal yang mendukung aliran darah sehat, termasuk aliran darah menuju otak.', 'Juga menyediakan vitamin K dan folat', facts[2], facts[3]),
      makeSlide(2, 'Buah Beri', 'Buah beri seperti blueberry dan stroberi kaya antosianin, senyawa antioksidan yang memberi warna khas pada buah tersebut.', 'Mendukung komunikasi antarsel dalam otak', facts[4], facts[5]),
      makeSlide(3, 'Pisang', 'Pisang mengandung vitamin B6 yang dibutuhkan tubuh untuk membentuk sejumlah neurotransmiter penting bagi berbagai fungsi otak.', 'Neurotransmiter terkait fungsi otak', facts[6], facts[7]),
      makeSlide(4, 'Jambu Biji', 'Jambu biji menyediakan vitamin C dalam jumlah tinggi dan vitamin tersebut berfungsi sebagai antioksidan di dalam tubuh.', 'Membantu perlindungan dari radikal bebas', facts[8], facts[9])
    ]
  };
}

test('bank Manual + URL mempertahankan fakta item artikel yang judulnya cocok dengan topik dan membuang Baca Juga', () => {
  const bank = extractManualFactBank([source], 'Daya ingat');
  assert.equal(bank.length, facts.length);
  assert.ok(bank.some(item => /Alpukat mengandung lemak/.test(item.evidence)));
  assert.ok(bank.some(item => /Jambu biji menyediakan vitamin C/.test(item.evidence)));
  assert.equal(bank.some(item => /asam urat|lemak perut/i.test(item.evidence)), false);
  assert.equal(desiredSlideCount('Listicle', [source], bank), 5);
});

test('density gate menolak output tipis seperti hasil produksi yang dilaporkan', () => {
  const bank = extractManualFactBank([source], 'Daya ingat');
  const thin = {
    slides: [
      { section: 'ITEM 1', title: 'Mengenal Daya Ingat', body: 'Otak memproses dan menyimpan informasi dalam berbagai tahap.', points: [], claims: [] },
      { section: 'ITEM 2', title: 'Faktor Memori', body: 'Konsumsi buah sebaiknya dilakukan sebelum atau sesudah makan.', points: [], claims: [] },
      { section: 'ITEM 3', title: 'Peran Nutrisi', body: 'Lima buah dapat membantu menurunkan asam urat secara alami.', points: [], claims: [] },
      { section: 'ITEM 4', title: 'Tips Ingatan', body: 'Delapan buah dapat membantu membakar lemak perut dalam sebulan.', points: [], claims: [] },
      { section: 'ITEM 5', title: 'Ringkasan', body: 'Buah dapat mendukung kesehatan.', points: [], claims: [] }
    ]
  };
  const errors = densityErrors(thin, bank);
  assert.equal(errors.filter(error => /density/.test(error)).length, 5);
});

test('claim gate menolak evidence dari related article yang tidak ada pada FACT_BANK bersih', () => {
  const bank = extractManualFactBank([source], 'Daya ingat');
  const content = richListicle();
  content.slides[2].body = 'Lima buah ini dapat membantu menurunkan asam urat secara alami menurut tautan artikel lain.';
  content.slides[2].claims = [{
    field: 'slide:2:body', text: content.slides[2].body, sourceId: 'source-1',
    evidence: '5 buah ini dapat menurunkan asam urat secara alami.'
  }];
  const errors = claimErrors(content, [source], 'Listicle', bank);
  assert.ok(errors.some(error => /evidence tidak ditemukan di sumber utama|bukan bagian FACT_BANK bersih/i.test(error)));
});

test('composer menghasilkan Listicle 5 item yang padat dan lolos audit source-backed', async () => {
  const raw = richListicle();
  let composeCalls = 0;
  let semanticCalls = 0;
  let coherenceCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/KOMPOSISI FINAL MANUAL \+ URL/i.test(prompt)) {
      composeCalls += 1;
      assert.match(prompt, /LISTICLE KETAT/i);
      assert.match(prompt, /Total body\+points minimal 20 kata/i);
      assert.match(prompt, /artikel lain, link terkait/i);
      return { choices: [{ message: { content: JSON.stringify(raw) } }] };
    }
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      semanticCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    if (/auditor final carousel berbasis sumber/i.test(messages[0].content)) {
      coherenceCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ invalid: [] }) } }] };
    }
    throw new Error(`Unexpected call: ${prompt.slice(0, 120)}`);
  } } } };

  const contentService = {
    validateContent() { return []; }
  };
  const result = await composeManualSourceContent({
    contentService,
    options: { requestedTopic: 'Daya ingat', contentFormat: 'Listicle' },
    sources: [source], client
  });

  assert.equal(composeCalls, 1);
  assert.equal(semanticCalls, 1);
  assert.equal(coherenceCalls, 1);
  assert.equal(result.slides.length, 5);
  assert.deepEqual(result.slides.map(slide => slide.section), ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4', 'ITEM 5']);
  result.slides.forEach(slide => {
    const count = slide.body.split(/\s+/).filter(Boolean).length + slide.points.join(' ').split(/\s+/).filter(Boolean).length;
    assert.ok(count >= 20);
    assert.ok(slide.claims.length >= 3);
  });
  assert.equal(JSON.stringify(result).match(/asam urat|lemak perut/i), null);
});
