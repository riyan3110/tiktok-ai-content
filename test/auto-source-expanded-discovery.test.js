const test = require('node:test');
const assert = require('node:assert/strict');
const discovery = require('../src/services/autoSourceExpandedDiscovery');

function article(url, title) {
  return {
    url,
    finalUrl: url,
    title,
    text: [
      `${title} adalah sistem baru yang dikembangkan untuk membantu pekerjaan software engineering.`,
      `${title} dapat menulis kode dan memperbaiki bagian program yang bermasalah.`,
      `${title} mendukung debugging serta pengujian pada alur pengembangan perangkat lunak.`,
      `${title} menggunakan beberapa proses AI untuk membagi pekerjaan menjadi tugas yang lebih kecil.`,
      `${title} memvalidasi hasil pekerjaan sebelum perubahan diteruskan ke tahap berikutnya.`,
      `${title} tersedia sebagai bagian dari pengujian produk untuk pengembang.`
    ].join(' '),
    fetchedAt: '2026-08-12T00:00:00.000Z'
  };
}

test('freshness ranking prefers newer dated candidates without rejecting undated sources', () => {
  const now = Date.parse('2026-08-12T00:00:00.000Z');
  assert.ok(discovery.freshnessScore('2026-08-11T00:00:00.000Z', now) > discovery.freshnessScore('2025-08-11T00:00:00.000Z', now));
  assert.equal(discovery.freshnessScore(null, now), 0);
});

test('publisher key collapses mobile/www variants of the same publisher', () => {
  assert.equal(discovery.publisherKey('https://www.example.com/a'), 'example.com');
  assert.equal(discovery.publisherKey('https://m.example.com/b'), 'example.com');
  assert.equal(discovery.publisherKey('https://tekno.example.co.id/a'), 'example.co.id');
});

test('expanded discovery rejects misleading fetched pages and selects different publishers', async () => {
  discovery.clearCache();
  const candidates = [
    { title: 'Muse Code official launch', url: 'https://www.alpha.example/muse-code-1', description: 'Muse Code software engineering AI', provider: 'test', publishedAt: '2026-08-12T00:00:00.000Z' },
    { title: 'Muse Code second report', url: 'https://m.alpha.example/muse-code-2', description: 'Muse Code coding agent', provider: 'test', publishedAt: '2026-08-11T00:00:00.000Z' },
    { title: 'Muse Code developer details', url: 'https://beta.example/muse-code', description: 'Muse Code software engineering', provider: 'test', publishedAt: '2026-08-10T00:00:00.000Z' },
    { title: 'Muse Code research overview', url: 'https://gamma.example/muse-code', description: 'Muse Code coding system', provider: 'test', publishedAt: '2026-08-09T00:00:00.000Z' },
    { title: 'Muse Code breaking news', url: 'https://irrelevant.example/muse-code', description: 'Muse Code AI coding', provider: 'test', publishedAt: '2026-08-12T00:00:00.000Z' }
  ];
  const searchImpl = async () => candidates;
  const sourceFetcher = {
    validateUrl: async raw => new URL(raw),
    fetchSources: async urls => {
      const url = urls[0];
      if (url.includes('irrelevant.example')) {
        return [{
          url,
          finalUrl: url,
          title: 'Resep masakan rumahan',
          text: 'Artikel ini membahas bahan makanan, resep, dapur, memasak, rasa, dan penyajian hidangan keluarga. Tidak ada pembahasan produk software.',
          fetchedAt: '2026-08-12T00:00:00.000Z'
        }];
      }
      return [article(url, 'Muse Code')];
    }
  };

  const result = await discovery.discover({
    topic: 'Muse Code',
    category: 'Edukasi teknologi',
    searchImpl,
    sourceFetcher,
    now: () => Date.parse('2026-08-12T00:00:00.000Z')
  });

  const publishers = result.sources.map(source => source.discovery.publisher);
  assert.equal(new Set(publishers).size, publishers.length, 'selected sources must come from different publishers');
  assert.ok(result.sources.length >= 2 && result.sources.length <= 4);
  assert.ok(!result.sources.some(source => /irrelevant\.example/.test(source.finalUrl)));
  assert.ok(result.queries.some(query => /latest|terbaru|official|research/i.test(query)));
});
