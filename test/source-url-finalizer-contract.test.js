const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { finalizerPrompt, targetSections, groupedFacts, contentShapeGoalErrors, MAX_FINALIZE_ATTEMPTS } = require('../src/services/sourceUrlFinalizer');
const {
  buildDeterministicSourceFallback,
  sourceCoverageErrors,
  presentationErrors,
  duplicateErrors,
  sourceFacts,
  sourceRichness,
  expandEvidenceForBody
} = require('../src/services/manualSourceFallback');
const { safeRecoveryFormat, aiThenDeterministicFallback } = require('../src/services/generation');

function sources() {
  return [
    { url: 'https://alpha.test/a', title: 'Alpha', text: 'Alpha memuat fakta pertama yang cukup rinci untuk dipakai sebagai konteks carousel. Alpha juga memiliki fakta kedua yang berbeda dan tetap relevan dengan topik utama. Alpha menambahkan detail ketiga yang dapat dipakai untuk bullet berbeda.' },
    { url: 'https://beta.test/b', title: 'Beta', text: 'Beta menjelaskan fakta lain yang dapat diverifikasi dari sumber kedua dan tidak mengulang Alpha. Beta menambahkan konteks kedua yang tetap berbeda. Beta juga memberi detail ketiga yang relevan.' },
    { url: 'https://gamma.test/c', title: 'Gamma', text: 'Gamma memberi fakta ketiga yang melengkapi konteks tanpa mengambil informasi dari luar artikel. Gamma juga memuat detail lanjutan yang berbeda. Gamma menambahkan satu fakta lain untuk melengkapi carousel.' }
  ];
}

function richFacts(count = 16) {
  return Array.from({ length: count }, (_, index) => ({
    sourceId: `source-${(index % 2) + 1}`,
    evidence: `Fakta sumber ${index + 1} memiliki detail berbeda yang cukup jelas untuk mendukung satu bagian konten tanpa pengulangan.`
  }));
}

test('prompt final AI memaksa semua URL, body panjang, dan 3 bullet untuk source kaya', () => {
  const input = sources();
  const facts = richFacts();
  const prompt = finalizerPrompt({
    generated: { slides: Array.from({ length: 4 }, (_, index) => ({ section: `ITEM ${index + 1}` })) },
    sources: input,
    facts,
    format: 'Listicle',
    topic: 'Topik uji',
    errors: ['slide:0:layout: body terlalu pendek']
  });

  for (const sourceId of ['source-1', 'source-2', 'source-3']) assert.match(prompt, new RegExp(sourceId));
  for (const source of input) assert.match(prompt, new RegExp(source.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /SETIAP sourceId yang tercantum WAJIB/i);
  assert.match(prompt, /BODY FACT BANK/i);
  assert.match(prompt, /BODY WAJIB minimal 10 kata/i);
  assert.match(prompt, /3 bullet fakta/i);
  assert.match(prompt, /JANGAN memakai evidence canonical yang sama dua kali/i);
  assert.equal(MAX_FINALIZE_ATTEMPTS, 3);
});

test('body fact bank hanya memberi evidence panjang yang benar-benar berasal dari source', () => {
  const input = sources();
  const groups = groupedFacts(input, sourceFacts(input));
  assert.equal(groups.length, 3);
  groups.forEach((group, index) => {
    assert.ok(group.bodyFacts.length > 0);
    group.bodyFacts.forEach(evidence => {
      assert.ok(evidence.trim().split(/\s+/).length >= 10);
      const normalizedSource = input[index].text.toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const normalizedEvidence = evidence.toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
      assert.ok(normalizedSource.includes(normalizedEvidence));
    });
  });
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

test('source kaya mewajibkan body minimal 10 kata dan 3 bullet fakta berbeda', () => {
  const facts = richFacts();
  const profile = sourceRichness(facts, 4);
  assert.equal(profile.targetPoints, 3);
  assert.equal(profile.minPoints, 3);
  assert.equal(profile.bodyMin, 10);
  assert.equal(profile.visibleGoal, 30);

  const valid = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Judul sumber ${index + 1}`,
      body: 'Penjelasan utama tetap natural dan seluruh isinya berasal dari fakta sumber yang terverifikasi.',
      points: ['Fakta tambahan pertama berbeda', 'Fakta tambahan kedua relevan', 'Fakta tambahan ketiga penting']
    }))
  };
  assert.equal(presentationErrors(valid, facts).some(error => /richness|layout/.test(error)), false);

  valid.slides[0].points = ['Fakta tambahan pertama berbeda', 'Fakta tambahan kedua relevan'];
  assert.ok(presentationErrors(valid, facts).some(error => /minimal 3 point fakta berbeda/i.test(error)));

  valid.slides[0].points = ['Fakta tambahan pertama berbeda', 'Fakta tambahan kedua relevan', 'Fakta tambahan ketiga penting'];
  valid.slides[0].body = 'Body ini masih terlalu pendek saja';
  assert.ok(presentationErrors(valid, facts).some(error => /body harus 10–24 kata/i.test(error)));
});

test('total word count bukan lagi hard failure tersendiri jika struktur minimum sudah terpenuhi', () => {
  const facts = richFacts();
  const content = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Judul ${index + 1}`,
      body: 'Satu dua tiga empat lima enam tujuh delapan sembilan sepuluh',
      points: ['Fakta pertama berbeda', 'Fakta kedua relevan', 'Fakta ketiga penting']
    }))
  };
  assert.equal(presentationErrors(content, facts).some(error => /kata visible|minimum aman|density/i.test(error)), false);
  assert.ok(contentShapeGoalErrors(content, facts).some(error => /perkaya menuju/i.test(error)));
});

test('evidence pendek dapat diperluas menjadi body source-backed minimal 10 kata tanpa mengarang', () => {
  const text = 'WhatsApp kembali memperbarui pengalaman percakapan pengguna. Fitur baru ini dijelaskan lebih lanjut dalam artikel dan membawa beberapa perubahan pada cara pengguna berinteraksi.';
  const evidence = 'WhatsApp kembali memperbarui pengalaman percakapan pengguna.';
  const expanded = expandEvidenceForBody(text, evidence, 10, 18);
  assert.ok(expanded.split(/\s+/).length >= 10);
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizedExpanded = expanded.toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(normalizedText.includes(normalizedExpanded));
});

test('fallback source-only tidak lagi membuat body pendek ketika source memiliki konteks cukup', () => {
  const input = Array.from({ length: 4 }, (_, index) => ({
    url: `https://source-${index + 1}.test/article`,
    title: `Sumber ${index + 1}`,
    text: `Fakta utama ${index + 1} cukup singkat untuk dibaca. Artikel sumber ${index + 1} lalu memberikan konteks tambahan yang lebih panjang dan dapat dipakai untuk menjelaskan fakta utama secara akurat. Detail berikutnya juga berbeda dan mendukung bullet lain. Fakta terakhir menambah konteks tanpa mengulang informasi sebelumnya.`
  }));
  const fallback = buildDeterministicSourceFallback({
    generated: { topic: 'Topik source' },
    sources: input,
    topic: 'Topik source',
    requestedFormat: 'Fakta singkat'
  });
  fallback.slides.forEach(slide => assert.ok(slide.body.split(/\s+/).length >= 10));
});

test('point maksimal tetap 7 kata dan renderer boleh menerima sampai 3 point', () => {
  const facts = richFacts();
  const valid = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Judul sumber ${index + 1}`,
      body: 'Penjelasan utama tetap natural dan seluruh isinya berasal dari fakta sumber yang terverifikasi.',
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
    text: `Sumber ${index + 1} memuat fakta utama yang berbeda untuk konteks carousel dan dapat diverifikasi. Sumber ${index + 1} juga memuat detail tambahan yang berbeda untuk melengkapi fakta utama. Sumber ${index + 1} memberi konteks ketiga yang tetap relevan. Sumber ${index + 1} menambahkan fakta keempat tanpa mengulang detail sebelumnya.`
  }));
  const fallback = buildDeterministicSourceFallback({
    generated: { topic: 'Topik multi sumber' },
    sources: manySources,
    topic: 'Topik multi sumber',
    requestedFormat: 'Fakta singkat'
  });
  assert.equal(sourceCoverageErrors(fallback, manySources).length, 0);
});

test('recovery URL hanya menjalankan satu finalizer bounded tanpa skeleton ping-pong', () => {
  const source = String(aiThenDeterministicFallback);
  assert.equal((source.match(/aiAllSourceRecovery/g) || []).length, 1);
  assert.doesNotMatch(source, /deterministicFallback|skeleton/);
});

test('recovery format tidak mengarang aksi ketika pipeline utama gagal', () => {
  assert.equal(safeRecoveryFormat('Listicle'), 'Listicle');
  assert.equal(safeRecoveryFormat('Fakta singkat'), 'Fakta singkat');
  for (const format of ['Tutorial langkah', 'Masalah dan solusi', 'Tips cepat', 'Before-after']) assert.equal(safeRecoveryFormat(format), 'Fakta singkat');
});