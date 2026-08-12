const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/sourceUrlFinalizer');

test('judul recovery Pakai URL selalu deklaratif dan bukan pertanyaan', () => {
  const sections = ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'];
  const titles = sections.map((section, index) => finalizer.structuralTitle(section, 'AI dalam Nasihat Keuangan', index));
  titles.forEach(title => {
    assert.doesNotMatch(title, /\?/);
    assert.match(title, /AI dalam Nasihat Keuangan/i);
  });
  assert.equal(new Set(titles).size, titles.length);
});

test('title error direpair lokal tanpa mengubah body dan bullet', () => {
  const content = {
    slides: [{
      section: 'PEMBUKA',
      title: 'Apa itu AI dalam keuangan?',
      body: 'AI digunakan sebagian orang untuk mencari informasi tentang layanan keuangan.',
      points: ['Sumber tetap perlu diperiksa', 'Nasihat profesional masih digunakan', 'Risiko hukum perlu dipahami'],
      claims: [
        { field: 'slide:0:title', text: 'Apa itu AI dalam keuangan?', sourceId: 'source-1', evidence: 'AI digunakan sebagian orang untuk mencari informasi tentang layanan keuangan.' },
        { field: 'slide:0:body', text: 'AI digunakan sebagian orang untuk mencari informasi tentang layanan keuangan.', sourceId: 'source-1', evidence: 'AI digunakan sebagian orang untuk mencari informasi tentang layanan keuangan.' }
      ]
    }]
  };
  const repaired = finalizer.repairProblematicTitles(content, ['slide:0:title: judul Pakai URL harus deklaratif, bukan pertanyaan.'], 'AI dalam Nasihat Keuangan');
  assert.equal(repaired.changed, true);
  assert.doesNotMatch(repaired.content.slides[0].title, /\?/);
  assert.equal(repaired.content.slides[0].body, content.slides[0].body);
  assert.deepEqual(repaired.content.slides[0].points, content.slides[0].points);
  assert.equal(repaired.content.slides[0].claims.some(claim => claim.field === 'slide:0:title'), false);
});

test('relevance bank mempertahankan context window dekat topik dan membuang blok jauh', () => {
  const sources = [{
    title: 'AI dalam Nasihat Keuangan',
    text: 'fixture only'
  }];
  const facts = Array.from({ length: 20 }, (_, index) => ({
    sourceId: 'source-1',
    evidence: index === 2 || index === 5 || index === 8
      ? `AI dan nasihat keuangan dibahas pada fakta utama ${index}.`
      : index >= 15
        ? `Blok artikel lain membahas pertandingan olahraga nomor ${index}.`
        : `Konteks pendukung artikel utama berada pada bagian ${index}.`
  }));
  const selected = finalizer.relevantSourceFacts(sources, facts, 'AI dalam Nasihat Keuangan');
  const text = selected.map(fact => fact.evidence).join(' ');
  assert.match(text, /Konteks pendukung artikel utama/);
  assert.doesNotMatch(text, /pertandingan olahraga/);
  assert.ok(selected.length >= 9);
});

test('source kaya mewajibkan tiga bullet per slide', () => {
  const facts = Array.from({ length: 16 }, (_, index) => ({ sourceId: 'source-1', evidence: `Fakta ${index + 1} berbeda dan didukung sumber.` }));
  const sparse = {
    slides: Array.from({ length: 4 }, (_, index) => ({
      title: `Topik Utama: Bagian ${index + 1}`,
      body: 'Body faktual yang cukup panjang untuk menjelaskan konteks sumber secara natural.',
      points: ['Satu fakta tambahan saja']
    }))
  };
  assert.equal(finalizer.urlDensityErrors(sparse, facts).length, 4);
  sparse.slides.forEach(slide => { slide.points = ['Fakta tambahan pertama', 'Fakta tambahan kedua', 'Fakta tambahan ketiga']; });
  assert.equal(finalizer.urlDensityErrors(sparse, facts).length, 0);
});

test('prompt Pakai URL melarang judul pertanyaan dan meminta kepadatan tiga bullet saat source kaya', () => {
  const sources = [{
    url: 'https://example.test/a',
    finalUrl: 'https://example.test/a',
    title: 'Topik Utama',
    text: Array.from({ length: 18 }, (_, index) => `Fakta sumber ${index + 1} menjelaskan konteks penting yang berbeda untuk artikel utama.`).join(' ')
  }];
  const facts = Array.from({ length: 16 }, (_, index) => ({ sourceId: 'source-1', evidence: `Fakta sumber ${index + 1} menjelaskan konteks penting yang berbeda untuk artikel utama.` }));
  const prompt = finalizer.finalizerPrompt({
    generated: { slides: ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'].map(section => ({ section })) },
    sources,
    facts,
    format: 'Fakta singkat',
    topic: 'Topik Utama',
    errors: []
  });
  assert.match(prompt, /JUDUL wajib deklaratif\/informatif/i);
  assert.match(prompt, /BUKAN kalimat tanya/i);
  assert.match(prompt, /3 bullet fakta berbeda/i);
  assert.match(prompt, /setiap sourceId harus menyumbang/i);
  assert.doesNotMatch(prompt, /Apa itu …|Apa yang bisa dilakukan|Bagaimana cara kerjanya/);
});
