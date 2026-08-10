const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { finalizerPrompt, targetSections, contentShapeGoalErrors, MAX_FINALIZE_ATTEMPTS } = require('../src/services/sourceUrlFinalizer');
const { buildDeterministicSourceFallback, sourceCoverageErrors, presentationErrors, duplicateErrors, sourceFacts, sourceRichness } = require('../src/services/manualSourceFallback');
const { safeRecoveryFormat } = require('../src/services/generation');

function sources() {
  return [
    { url: 'https://alpha.test/a', title: 'Alpha', text: 'Alpha memuat fakta pertama yang cukup rinci untuk dipakai sebagai konteks carousel. Alpha juga memiliki fakta kedua yang berbeda dan tetap relevan dengan topik utama.' },
    { url: 'https://beta.test/b', title: 'Beta', text: 'Beta menjelaskan fakta lain yang dapat diverifikasi dari sumber kedua dan tidak mengulang Alpha. Beta menambahkan konteks kedua yang tetap berbeda.' },
    { url: 'https://gamma.test/c', title: 'Gamma', text: 'Gamma memberi fakta ketiga yang melengkapi konteks tanpa mengambil informasi dari luar artikel. Gamma juga memuat detail lanjutan yang berbeda.' }
  ];
}

function richFacts(count = 16) {
  return Array.from({ length: count }, (_, index) => ({
    sourceId: `source-${(index % 2) + 1}`,
    evidence: `Fakta sumber ${index + 1} memiliki detail berbeda yang cukup jelas untuk mendukung satu bagian konten tanpa pengulangan.`
  }));
}

test('prompt final AI memaksa semua URL dan memakai pola title + body + 2-3 bullet', () => {
  const input = sources();
  const facts = richFacts();
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
  assert.match(prompt, /body 10–18 kata/i);
  assert.match(prompt, /2–3 bullet/i);
  assert.match(prompt, /PAKSA 3 bullet/i);
  assert.match(prompt, /Maksimal 3 bullet/i);
  assert.match(prompt, /JANGAN memakai evidence canonical yang sama dua kali/i);
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

test('source kaya menargetkan 3 bullet tetapi hard gate menerima 2 bullet yang sudah padat dan faktual', () => {
  const facts = richFacts();
  const profile = sourceRichness(facts, 4);
  assert.equal(profile.targetPoints, 3);
  assert.equal(profile.minPoints, 2);
  assert.equal(profile.visibleGoal, 27);
  assert.equal(profile.hardFloor, 18);

  const content = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Judul sumber ${index + 1}`,
      body: 'Penjelasan utama tetap natural dan seluruh isinya berasal dari fakta sumber.',
      points: ['Fakta tambahan pertama berbeda', 'Fakta tambahan kedua relevan']
    }))
  };
  const errors = presentationErrors(content, facts);
  assert.equal(errors.some(error => /richness|layout/.test(error)), false);
  assert.ok(contentShapeGoalErrors(content, facts).some(error => /target 3 bullet/i.test(error)));
});

test('source kaya menolak slide yang hanya punya satu bullet agar AI dipaksa memperkaya', () => {
  const facts = richFacts();
  const content = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Judul sumber ${index + 1}`,
      body: 'Penjelasan utama tetap natural dan seluruh isinya berasal dari fakta sumber.',
      points: ['Hanya satu fakta tambahan']
    }))
  };
  assert.ok(presentationErrors(content, facts).some(error => /minimal 2 point fakta berbeda/i.test(error)));
});

test('point maksimal tetap 7 kata dan renderer boleh menerima sampai 3 point', () => {
  const facts = richFacts();
  const valid = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Judul sumber ${index + 1}`,
      body: 'Penjelasan utama tetap natural dan seluruh isinya berasal dari fakta sumber.',
      points: ['Detail pertama berasal dari sumber', 'Detail kedua tetap relevan', 'Detail ketiga menambah konteks']
    }))
  };
  assert.equal(presentationErrors(valid, facts).some(error => /maksimal 3 point|3–7 kata/.test(error)), false);
  valid.slides[0].points[0] = 'Satu dua tiga empat lima enam tujuh delapan';
  assert.ok(presentationErrors(valid, facts).some(error => /point harus 3–7 kata/.test(error)));
});

test('evidence canonical yang sama tidak boleh dipakai dua kali dalam satu slide', () => {
  const repeated = 'Evidence faktual yang sama dari sumber';
  const content = {
    slides: [{
      title: 'Judul', body: 'Body sumber yang cukup jelas', points: ['Poin pertama', 'Poin kedua'],
      claims: [
        { field: 'slide:0:body', text: 'Body sumber yang cukup jelas', sourceId: 'source-1', evidence: repeated },
        { field: 'slide:0:point:0', text: 'Poin pertama', sourceId: 'source-1', evidence: repeated }
      ]
    }]
  };
  assert.ok(duplicateErrors(content).some(error => /dalam satu slide/i.test(error)));
});

test('fallback terakhir tetap mencakup semua URL meski jumlah URL melebihi jumlah slide', () => {
  const manySources = Array.from({ length: 6 }, (_, index) => ({
    url: `https://source-${index + 1}.test/article`,
    title: `Sumber ${index + 1}`,
    text: `Sumber ${index + 1} memuat fakta utama yang berbeda untuk konteks carousel dan dapat diverifikasi. Sumber ${index + 1} juga memuat detail tambahan yang berbeda untuk melengkapi fakta utama.`
  }));
  const fallback = buildDeterministicSourceFallback({
    generated: { topic: 'Topik multi sumber' },
    sources: manySources,
    topic: 'Topik multi sumber',
    requestedFormat: 'Fakta singkat'
  });
  assert.equal(sourceCoverageErrors(fallback, manySources).length, 0);
});

test('recovery format tidak mengarang aksi ketika pipeline utama gagal', () => {
  assert.equal(safeRecoveryFormat('Listicle'), 'Listicle');
  assert.equal(safeRecoveryFormat('Fakta singkat'), 'Fakta singkat');
  for (const format of ['Tutorial langkah', 'Masalah dan solusi', 'Tips cepat', 'Before-after']) {
    assert.equal(safeRecoveryFormat(format), 'Fakta singkat');
  }
});
