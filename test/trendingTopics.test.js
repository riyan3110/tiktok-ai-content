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
