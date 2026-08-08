const test = require('node:test');
const assert = require('node:assert/strict');

const { createDatabase } = require('../src/db');
const { generateAndSave } = require('../src/services/generation');

const fakeImages = { createSlides: async () => ['/generated/slide.jpg'] };

function verifiedContent(topic) {
  return {
    focus: { masalah: 'Masalah', penyebab: 'Penyebab', solusi: 'Solusi', hasil: 'Hasil' },
    topic,
    hook: 'Hook natural',
    body: 'Isi terverifikasi',
    caption: 'Isi terverifikasi',
    hashtags: [],
    cta: 'Penutup natural',
    trendKeywordsUsed: [],
    content_angle: 'angle sumber',
    primary_tool: 'tanpa tool',
    hook_pattern: 'hook natural',
    verificationStatus: 'source_based',
    unsupportedClaims: [],
    slides: [
      { section: 'PEMBUKA', title: 'Hook natural', body: 'Pembuka bermakna.', points: [] },
      { section: 'PENJELASAN', title: 'Fakta pertama', body: 'Isi terverifikasi.', points: [] },
      { section: 'PENJELASAN', title: 'Fakta kedua', body: 'Isi lain terverifikasi.', points: [] },
      { section: 'PENUTUP', title: 'Penutup natural', body: 'Cek konteksnya.', points: [] }
    ]
  };
}

test('source mode memakai persis URL user dan melewati sourceFilter, bukan source generation lama', async () => {
  const db = createDatabase(':memory:');
  const requestedUrls = ['https://one.test/article', 'https://two.test/article'];
  let fetchedUrls;
  let filterInput;
  let directGenerateCalls = 0;

  const sourceFetcher = {
    validateSourceUrls: urls => urls,
    fetchSources: async urls => {
      fetchedUrls = [...urls];
      return urls.map((url, index) => ({ url, finalUrl: url, title: `Sumber ${index + 1}`, text: `Isi sumber ${index + 1} yang cukup panjang untuk tes.`, fetchedAt: '2026-08-08T00:00:00.000Z' }));
    }
  };
  const content = {
    generateContent: async () => {
      directGenerateCalls += 1;
      throw new Error('generation.js tidak boleh memanggil source generation lama secara langsung');
    }
  };
  const sourceFilter = {
    generateFilteredContent: async input => {
      filterInput = input;
      return verifiedContent('Topik manual baru');
    }
  };

  const id = await generateAndSave({
    db,
    mode: 'manual',
    requestedTopic: 'Topik manual baru',
    category: 'Edukasi teknologi',
    format: 'Fakta singkat',
    useSources: true,
    sourceUrls: requestedUrls,
    sourceFetcher,
    sourceFilter,
    content,
    images: fakeImages,
    useTrendReference: false
  });

  assert.equal(directGenerateCalls, 0);
  assert.deepEqual(fetchedUrls, requestedUrls);
  assert.deepEqual(filterInput.sources.map(source => source.url), requestedUrls);
  assert.equal(filterInput.options.requestedTopic, 'Topik manual baru');
  assert.equal(filterInput.options.contentFormat, 'Fakta singkat');
  assert.equal(db.prepare('SELECT topic FROM contents WHERE id=?').get(id).topic, 'Topik manual baru');
  db.close();
});
