const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { finalizerPrompt, targetSections, MAX_FINALIZE_ATTEMPTS } = require('../src/services/sourceUrlFinalizer');
const { presentationErrors, sourceFacts, densityGoal, densityTarget } = require('../src/services/manualSourceFallback');
const { safeRecoveryFormat } = require('../src/services/generation');

function sources() {
  return [
    { url: 'https://alpha.test/a', title: 'Alpha', text: 'Alpha memuat fakta pertama yang cukup rinci untuk dipakai sebagai konteks carousel. Alpha juga memiliki fakta kedua yang berbeda dan tetap relevan dengan topik utama.' },
    { url: 'https://beta.test/b', title: 'Beta', text: 'Beta menjelaskan fakta lain yang dapat diverifikasi dari sumber kedua dan tidak mengulang Alpha. Beta menambahkan konteks kedua yang tetap berbeda.' },
    { url: 'https://gamma.test/c', title: 'Gamma', text: 'Gamma memberi fakta ketiga yang melengkapi konteks tanpa mengambil informasi dari luar artikel. Gamma juga memuat detail lanjutan yang berbeda.' }
  ];
}

test('prompt final AI memaksa semua URL/sourceId dipakai dan mengikuti layout renderer', () => {
  const input = sources();
  const facts = sourceFacts(input);
  const prompt = finalizerPrompt({
    generated: { slides: Array.from({ length: 4 }, (_, index) => ({ section: `ITEM ${index + 1}` })) },
    sources: input,
    facts,
    format: 'Listicle',
    topic: 'Topik uji',
    errors: ['coverage: source-3 belum dipakai']
  });

  for (const sourceId of ['source-1', 'source-2', 'source-3']) assert.match(prompt, new RegExp(sourceId));
  for (const source of input) assert.match(prompt, new RegExp(source.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /SETIAP sourceId yang tercantum WAJIB/i);
  assert.match(prompt, /body 18–24 kata/i);
  assert.match(prompt, /maksimal 2 points/i);
  assert.match(prompt, /point maksimal 7 kata/i);
  assert.match(prompt, /PAKSA kepadatan/i);
  assert.match(prompt, /Jangan mengulang ide/i);
  assert.equal(MAX_FINALIZE_ATTEMPTS, 3);
});

test('Listicle recovery mengikuti jumlah 5 item eksplisit dari judul sumber', () => {
  const input = [{
    url: 'https://example.test/listicle',
    title: '5 Daftar Robot Humanoid yang Perlu Diketahui',
    text: 'Robot pertama memiliki kemampuan berbeda yang dijelaskan oleh sumber. Robot kedua mempunyai fitur lain yang dibahas terpisah. Robot ketiga memiliki konteks penggunaan berbeda. Robot keempat dijelaskan dengan kemampuan khusus. Robot kelima menjadi item terakhir dalam daftar sumber.'
  }];
  const sections = targetSections(
    { slides: Array.from({ length: 4 }, (_, index) => ({ section: `ITEM ${index + 1}` })) },
    'Listicle',
    sourceFacts(input),
    input,
    'Robot humanoid'
  );
  assert.deepEqual(sections, ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4', 'ITEM 5']);
});

test('final source presentation gate sama dengan layout: point 7 diterima, point 8 ditolak', () => {
  const facts = sourceFacts(sources());
  const valid = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Judul sumber ${index + 1}`,
      body: 'Satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas tiga belas empat belas lima belas enam belas tujuh belas delapan belas.',
      points: ['Detail tambahan tetap berasal dari sumber utama']
    }))
  };
  assert.equal(presentationErrors(valid, facts).some(error => /maksimal 24|3–7 kata/.test(error)), false);

  valid.slides[0].points = ['Satu dua tiga empat lima enam tujuh delapan'];
  assert.ok(presentationErrors(valid, facts).some(error => /point harus 3–7 kata/.test(error)));
});

test('artikel kaya tetap menargetkan 30 kata tetapi 27 kata source-backed tidak dibuang', () => {
  const evidence = Array.from({ length: 24 }, (_, index) => `kata${index + 1}`).join(' ');
  const richFacts = Array.from({ length: 8 }, (_, index) => ({ sourceId: 'source-1', evidence: `${evidence} fakta${index + 1}` }));
  assert.equal(densityGoal(richFacts, 4), 30);
  assert.equal(densityTarget(richFacts, 4), 26);

  const content = {
    slides: Array.from({ length: 4 }, () => ({
      title: 'Judul padat sumber',
      body: Array.from({ length: 18 }, (_, index) => `isi${index + 1}`).join(' '),
      points: [Array.from({ length: 6 }, (_, index) => `detail${index + 1}`).join(' ')]
    }))
  };
  const errors = presentationErrors(content, richFacts);
  assert.equal(errors.some(error => /density/.test(error)), false);
});

test('recovery format tidak mengarang aksi ketika pipeline utama gagal', () => {
  assert.equal(safeRecoveryFormat('Listicle'), 'Listicle');
  assert.equal(safeRecoveryFormat('Fakta singkat'), 'Fakta singkat');
  for (const format of ['Tutorial langkah', 'Masalah dan solusi', 'Tips cepat', 'Before-after']) {
    assert.equal(safeRecoveryFormat(format), 'Fakta singkat');
  }
});
