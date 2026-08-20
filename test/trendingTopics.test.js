const test = require('node:test');
const assert = require('node:assert/strict');
const { relevantTopics } = require('../src/services/trendingTopics');

test('trendingTopics menerima beberapa bentuk payload dan menyaring niche', () => {
  assert.deepEqual(relevantTopics({ data: [
    { title: 'Tutorial Canva AI terbaru' },
    { title: 'Berita sepak bola' },
    'Strategi UGC untuk TikTok'
  ] }), ['Tutorial Canva AI terbaru', 'Strategi UGC untuk TikTok']);
});
test('trendingTopics menyaring tren berdasarkan kategori pilihan', () => {
  assert.deepEqual(relevantTopics(['Tips fokus kerja', 'Strategi iklan produk'], 'Produktivitas'), ['Tips fokus kerja']);
  assert.deepEqual(relevantTopics(['Fakta sains laut', 'Tutorial Canva'], 'Fakta unik'), ['Fakta sains laut']);
});
