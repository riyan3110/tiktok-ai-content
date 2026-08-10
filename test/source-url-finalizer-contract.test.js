const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { finalizerPrompt } = require('../src/services/sourceUrlFinalizer');
const { presentationErrors, sourceFacts } = require('../src/services/manualSourceFallback');
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
  assert.match(prompt, /Jangan mengulang ide/i);
});

test('final source presentation gate sama dengan layout: body 24 dan point 7 diterima, point 8 ditolak', () => {
  const facts = sourceFacts(sources());
  const valid = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Judul sumber ${index + 1}`,
      body: 'Satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas tiga belas empat belas lima belas enam belas tujuh belas delapan belas.',
      points: ['Detail tambahan tetap dari sumber']
    }))
  };
  assert.equal(presentationErrors(valid, facts).some(error => /maksimal 24|3–7 kata/.test(error)), false);

  valid.slides[0].points = ['Satu dua tiga empat lima enam tujuh delapan'];
  assert.ok(presentationErrors(valid, facts).some(error => /point harus 3–7 kata/.test(error)));
});

test('recovery format tidak mengarang aksi ketika pipeline utama gagal', () => {
  assert.equal(safeRecoveryFormat('Listicle'), 'Listicle');
  assert.equal(safeRecoveryFormat('Fakta singkat'), 'Fakta singkat');
  for (const format of ['Tutorial langkah', 'Masalah dan solusi', 'Tips cepat', 'Before-after']) {
    assert.equal(safeRecoveryFormat(format), 'Fakta singkat');
  }
});
