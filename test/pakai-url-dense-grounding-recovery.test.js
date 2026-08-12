const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const sourceFilter = require('../src/services/sourceFilter');
const finalizer = require('../src/services/sourceUrlFinalizer');

function source() {
  return [{
    url: 'https://example.test/ai-transparency',
    finalUrl: 'https://example.test/ai-transparency',
    title: 'Transparansi model AI dan watermark',
    text: [
      'Perusahaan AI menambahkan watermark pada keluaran model untuk meningkatkan transparansi bagi pengguna.',
      'Watermark membantu pengguna mengenali bahwa suatu keluaran dibuat oleh sistem kecerdasan buatan.',
      'Kebijakan transparansi juga mendorong penyedia model menjelaskan asal keluaran secara lebih jelas.',
      'Pengguna tetap perlu memeriksa konteks sebelum mempercayai informasi yang dihasilkan oleh model AI.',
      'Penyedia model dapat memakai metadata untuk membantu proses identifikasi konten yang dibuat AI.',
      'Penerapan transparansi tidak menghilangkan kebutuhan pengguna untuk memeriksa sumber informasi asli.',
      'Aturan transparansi menekankan pentingnya penandaan konten yang dihasilkan oleh sistem otomatis.',
      'Informasi tentang metode penandaan perlu disampaikan secara jelas agar pengguna memahami fungsinya.'
    ].join(' ')
  }];
}

function denseCandidate({ badTitle = false, badNumber = false } = {}) {
  const rows = [
    ['PEMBUKA', 'Apa itu transparansi AI?', 'Perusahaan AI menambahkan watermark pada keluaran model untuk meningkatkan transparansi bagi pengguna.', 'Watermark membantu pengguna mengenali keluaran AI', 'Watermark membantu pengguna mengenali bahwa suatu keluaran dibuat oleh sistem kecerdasan buatan.'],
    ['FAKTA UTAMA', badTitle ? 'Watermark Berlaku 2 Agustus' : 'Apa fungsi watermark?', badNumber ? 'Watermark diwajibkan mulai 2 Agustus untuk meningkatkan transparansi keluaran model.' : 'Kebijakan transparansi mendorong penyedia model menjelaskan asal keluaran secara lebih jelas.', 'Pengguna tetap perlu memeriksa konteks', 'Pengguna tetap perlu memeriksa konteks sebelum mempercayai informasi yang dihasilkan oleh model AI.'],
    ['KONTEKS', 'Bagaimana proses identifikasinya?', 'Penyedia model dapat memakai metadata untuk membantu proses identifikasi konten yang dibuat AI.', 'Sumber asli tetap perlu diperiksa', 'Penerapan transparansi tidak menghilangkan kebutuhan pengguna untuk memeriksa sumber informasi asli.'],
    ['KESIMPULAN', 'Apa yang perlu diingat?', 'Aturan transparansi menekankan pentingnya penandaan konten yang dihasilkan oleh sistem otomatis.', 'Metode penandaan perlu dijelaskan', 'Informasi tentang metode penandaan perlu disampaikan secara jelas agar pengguna memahami fungsinya.']
  ];
  const bodyEvidence = [
    'Perusahaan AI menambahkan watermark pada keluaran model untuk meningkatkan transparansi bagi pengguna.',
    'Kebijakan transparansi juga mendorong penyedia model menjelaskan asal keluaran secara lebih jelas.',
    'Penyedia model dapat memakai metadata untuk membantu proses identifikasi konten yang dibuat AI.',
    'Aturan transparansi menekankan pentingnya penandaan konten yang dihasilkan oleh sistem otomatis.'
  ];
  const slides = rows.map((row, index) => ({
    section: row[0],
    title: row[1],
    body: row[2],
    points: [row[3]],
    claims: [
      {
        field: `slide:${index}:body`,
        text: row[2],
        sourceId: 'source-1',
        evidence: index === 1 && badNumber ? bodyEvidence[index] : bodyEvidence[index]
      },
      {
        field: `slide:${index}:point:0`,
        text: row[3],
        sourceId: 'source-1',
        evidence: row[4]
      }
    ]
  }));
  return {
    topic: 'Transparansi model AI dan watermark',
    effectiveContentFormat: 'Fakta singkat',
    hook: slides[0].title,
    body: slides[1].body,
    caption: slides[1].body,
    cta: slides.at(-1).title,
    slides
  };
}

function responseFor(content) {
  return { choices: [{ message: { content: JSON.stringify({ slides: content.slides }) } }] };
}

function clientSequence(responses) {
  let calls = 0;
  return {
    get calls() { return calls; },
    chat: { completions: { create: async () => responses[Math.min(calls++, responses.length - 1)] } }
  };
}

function disableSemanticAudit(t) {
  const original = sourceFilter.auditClaimSemantics;
  sourceFilter.auditClaimSemantics = async () => [];
  t.after(() => { sourceFilter.auditClaimSemantics = original; });
}

test('prompt Pakai URL generik memaksa density dan semua source tanpa nama kasus khusus', () => {
  const sources = source();
  const facts = Array.from({ length: 16 }, (_, index) => ({
    sourceId: 'source-1',
    evidence: `Fakta sumber nomor ${index + 1} menjelaskan konteks berbeda yang cukup panjang untuk mendukung isi carousel.`
  }));
  const prompt = finalizer.finalizerPrompt({
    generated: { slides: Array.from({ length: 4 }, (_, index) => ({ section: ['PEMBUKA','FAKTA UTAMA','KONTEKS','KESIMPULAN'][index] })) },
    sources,
    facts,
    format: 'Fakta singkat',
    topic: 'Topik pengujian generik',
    errors: []
  });
  assert.match(prompt, /Gunakan SEMUA URL/i);
  assert.match(prompt, /body \+ 3 bullet/i);
  assert.match(prompt, /judul \+ satu body \+ 3 bullet/i);
  assert.doesNotMatch(prompt, /Smart PAI|Muse Code|Anthropic|Alibaba/i);
});

test('relevance bank tetap mempertahankan fakta dari setiap URL', () => {
  const sources = [
    {
      url: 'https://a.test', title: 'Alpha tentang keamanan AI',
      text: 'Keamanan AI membutuhkan evaluasi risiko sebelum sistem dipakai pengguna. Evaluasi membantu tim memahami keterbatasan model sebelum peluncuran. Pengujian dilakukan untuk menemukan perilaku yang tidak diharapkan. Dokumentasi membantu pengguna memahami batas penggunaan sistem.'
    },
    {
      url: 'https://b.test', title: 'Beta konteks kebijakan',
      text: 'Kebijakan internal menjelaskan proses peninjauan sebelum sebuah sistem dirilis. Tim mencatat perubahan penting agar proses audit dapat dilakukan. Dokumentasi kebijakan disimpan untuk mendukung pemeriksaan berikutnya. Pengguna dapat membaca ringkasan kebijakan yang telah dipublikasikan.'
    }
  ];
  const facts = require('../src/services/manualSourceFallback').sourceFacts(sources);
  const relevant = finalizer.relevantSourceFacts(sources, facts, 'keamanan AI');
  const ids = new Set(relevant.map(fact => fact.sourceId));
  assert.equal(ids.has('source-1'), true);
  assert.equal(ids.has('source-2'), true);
});

test('title faktual tanpa evidence diperbaiki lokal menjadi pertanyaan struktural', () => {
  const content = denseCandidate({ badTitle: true });
  const repaired = finalizer.repairProblematicTitles(
    content,
    ['slide:1:title: klaim faktual tidak memiliki evidence.'],
    content.topic,
    'Fakta singkat'
  );
  assert.equal(repaired.changed, true);
  assert.match(repaired.content.slides[1].title, /\?$/);
  assert.doesNotMatch(repaired.content.slides[1].title, /2 Agustus/);
  assert.equal(repaired.content.slides[1].body, content.slides[1].body);
});

test('numeric grounding error sekarang menunjuk field yang harus direpair', () => {
  const bad = denseCandidate({ badNumber: true });
  const errors = finalizer.numericGroundingErrors(bad);
  assert.ok(errors.some(error => /slide:1:body/.test(error)));
  assert.ok(errors.some(error => /2 Agustus/.test(error)));
});

test('missing title evidence tidak memicu putaran AI kedua bila body dan bullet sudah valid', async t => {
  disableSemanticAudit(t);
  const candidate = denseCandidate({ badTitle: true });
  const client = clientSequence([responseFor(candidate)]);
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: candidate,
    sources: source(),
    topic: candidate.topic,
    format: 'Fakta singkat',
    mode: 'manual',
    client
  });
  assert.equal(client.calls, 1);
  assert.match(result.slides[1].title, /\?$/);
  assert.doesNotMatch(result.slides[1].title, /2 Agustus/);
});

test('numeric mismatch diregenerasi sekali dari source bank lalu menghasilkan konten', async t => {
  disableSemanticAudit(t);
  const bad = denseCandidate({ badNumber: true });
  const good = denseCandidate();
  const client = clientSequence([responseFor(bad), responseFor(good)]);
  const result = await finalizer.rewriteAllSourcesWithAi({
    generated: bad,
    sources: source(),
    topic: bad.topic,
    format: 'Fakta singkat',
    mode: 'manual',
    client
  });
  assert.equal(client.calls, 2);
  assert.equal(JSON.stringify(result.slides).includes('2 Agustus'), false);
  assert.equal(finalizer.numericGroundingErrors(result).length, 0);
  assert.equal(result.slides.length, 4);
});
