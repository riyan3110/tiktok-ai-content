const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const fallback = require('../src/services/manualSourceFallback');
const finalizer = require('../src/services/sourceUrlFinalizer');

test('related content di URL yang sama tidak boleh menjadi evidence final', () => {
  const sources = [{
    url: 'https://example.test/adopsi-ai',
    finalUrl: 'https://example.test/adopsi-ai',
    title: 'Adopsi AI Meningkat di Dunia Kerja',
    text: [
      'Adopsi AI meningkat ketika organisasi mulai memakai teknologi untuk membantu proses kerja sehari-hari.',
      'Strategi adopsi AI perlu disesuaikan dengan kebutuhan organisasi dan kemampuan tim yang menjalankannya.',
      'Pengelolaan adopsi AI juga membutuhkan evaluasi risiko serta aturan internal yang dipahami pekerja.',
      'Organisasi yang mengadopsi AI perlu menilai proses kerja agar penerapan teknologi tetap memiliki tujuan jelas.',
      'Tim yang menjalankan adopsi AI perlu memahami batas penggunaan sistem dan tanggung jawab pengawasan manusia.',
      'Ponsel lipat terbaru menawarkan kamera 200 MP dan layar baru untuk konsumen perangkat premium.',
      'Berita olahraga hari ini membahas pertandingan besar yang berlangsung pada akhir pekan.'
    ].join(' ')
  }];
  const all = fallback.sourceFacts(sources);
  const relevant = finalizer.relevantSourceFacts(sources, all, 'Adopsi AI Meningkat');
  const joined = relevant.map(fact => fact.evidence).join(' ');
  assert.match(joined, /adopsi AI/i);
  assert.doesNotMatch(joined, /200 MP|ponsel lipat|pertandingan besar/i);

  const leaked = {
    slides: [{
      section: 'PEMBUKA',
      title: 'Kamera Baru untuk Ponsel Lipat',
      body: 'Ponsel lipat terbaru menawarkan kamera 200 MP untuk konsumen perangkat premium.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'Ponsel lipat terbaru menawarkan kamera 200 MP untuk konsumen perangkat premium.',
        sourceId: 'source-1',
        evidence: 'Ponsel lipat terbaru menawarkan kamera 200 MP dan layar baru untuk konsumen perangkat premium.'
      }]
    }]
  };
  assert.ok(finalizer.evidenceBankErrors(leaked, sources, relevant).some(error => /url-bank/i.test(error)));
});

test('fact plan membagi evidence unik untuk body dan bullet tanpa mengulang canonical fact', () => {
  const sources = [
    { url: 'https://a.test', title: 'A', text: 'fixture' },
    { url: 'https://b.test', title: 'B', text: 'fixture' }
  ];
  const facts = Array.from({ length: 16 }, (_, index) => ({
    sourceId: index % 2 === 0 ? 'source-1' : 'source-2',
    evidence: `Fakta unik nomor ${index + 1} menjelaskan bagian berbeda dari topik yang sedang dibahas.`
  }));
  const plan = finalizer.buildFactPlan(sources, facts, 4);
  assert.equal(plan.length, 4);
  plan.forEach(slideFacts => assert.equal(slideFacts.length, 4));
  const keys = plan.flat().map(fact => `${fact.sourceId}:${fact.evidence}`);
  assert.equal(new Set(keys).size, 16);
  assert.ok(new Set(plan.flat().map(fact => fact.sourceId)).size >= 2);
});

test('point fragment yang terdeteksi dibuang dan claim berikutnya direindex dengan benar', () => {
  const content = {
    topic: 'Adopsi AI',
    slides: [{
      section: 'FAKTA UTAMA',
      title: 'Strategi Adopsi Membutuhkan Evaluasi',
      body: 'Organisasi perlu menilai kebutuhan dan risiko sebelum memperluas penerapan AI pada proses kerja.',
      points: ['hingga tata kelola katanya', 'Risiko perlu dievaluasi berkala', 'Ia menilai masih ada pekerjaan'],
      claims: [
        { field: 'slide:0:body', text: 'Organisasi perlu menilai kebutuhan dan risiko sebelum memperluas penerapan AI pada proses kerja.', sourceId: 'source-1', evidence: 'Organisasi perlu menilai kebutuhan dan risiko sebelum memperluas penerapan AI pada proses kerja.' },
        { field: 'slide:0:point:0', text: 'hingga tata kelola katanya', sourceId: 'source-1', evidence: 'Kebijakan internal membahas tata kelola penggunaan teknologi.' },
        { field: 'slide:0:point:1', text: 'Risiko perlu dievaluasi berkala', sourceId: 'source-1', evidence: 'Risiko penggunaan teknologi perlu dievaluasi secara berkala oleh organisasi.' },
        { field: 'slide:0:point:2', text: 'Ia menilai masih ada pekerjaan', sourceId: 'source-1', evidence: 'Organisasi masih memiliki pekerjaan untuk memperkuat pengawasan sistem.' }
      ]
    }]
  };
  const repaired = finalizer.dropProblematicPoints(content, [
    'slide:0:point:0: bullet berupa fragmen/kutipan gantung dan harus ditulis ulang utuh.',
    'slide:0:point:2: bullet berupa fragmen/kutipan gantung dan harus ditulis ulang utuh.'
  ]);
  assert.equal(repaired.changed, true);
  assert.deepEqual(repaired.content.slides[0].points, ['Risiko perlu dievaluasi berkala']);
  const claim = repaired.content.slides[0].claims.find(item => item.field === 'slide:0:point:0');
  assert.ok(claim);
  assert.equal(claim.text, 'Risiko perlu dievaluasi berkala');
});

test('raw deterministic URL fallback dinonaktifkan untuk hasil user-facing', () => {
  assert.equal(finalizer.emergencySourceOnlyFallback(), null);
  assert.equal(finalizer.buildUrlSourceFallback(), null);
});

test('prompt melarang bug visual terbaru dan tetap meminta output padat', () => {
  const sources = [{
    url: 'https://example.test/a', finalUrl: 'https://example.test/a', title: 'Adopsi AI',
    text: Array.from({ length: 16 }, (_, index) => `Adopsi AI memiliki fakta unik ${index + 1} yang menjelaskan konteks penerapan teknologi dalam organisasi.`).join(' ')
  }];
  const facts = fallback.sourceFacts(sources);
  const prompt = finalizer.finalizerPrompt({
    generated: { slides: ['PEMBUKA','FAKTA UTAMA','KONTEKS','KESIMPULAN'].map(section => ({ section })) },
    sources,
    facts,
    format: 'Fakta singkat',
    topic: 'Adopsi AI',
    errors: []
  });
  assert.match(prompt, /DRAF LAMA DILARANG disalin/i);
  assert.match(prompt, /related article/i);
  assert.match(prompt, /lokasi dateline/i);
  assert.match(prompt, /Jangan memakai pola berulang/i);
  assert.match(prompt, /Bullet DILARANG dimulai/i);
  assert.match(prompt, /3 bullet fakta berbeda/i);
  assert.match(prompt, /SETIAP sourceId yang tercantum WAJIB/i);
});
