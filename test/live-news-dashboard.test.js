const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFeedXml } = require('../src/services/liveNews');

test('live news parser keeps headline, image, and source URL from RSS items', () => {
  const items = parseFeedXml(`<?xml version="1.0"?><rss><channel><item><title>Berita terbaru &amp; penting</title><link>https://example.com/news/1</link><pubDate>Sun, 20 Sep 2026 02:00:00 GMT</pubDate><description><![CDATA[Ringkasan berita]]></description><enclosure url="https://example.com/news.jpg" type="image/jpeg"/></item></channel></rss>`);
  assert.deepEqual(items, [{
    title: 'Berita terbaru & penting',
    url: 'https://example.com/news/1',
    image: 'https://example.com/news.jpg',
    summary: 'Ringkasan berita',
    publishedAt: 'Sun, 20 Sep 2026 02:00:00 GMT'
  }]);
});

test('dashboard replaces the two feature cards with a swipeable live news carousel', () => {
  const theme = fs.readFileSync(path.join(__dirname, '..', 'public', 'floating-chat-theme.js'), 'utf8');
  const liveNews = fs.readFileSync(path.join(__dirname, '..', 'public', 'live-news.js'), 'utf8');
  assert.match(theme, /neo-news-carousel/);
  assert.match(theme, /LiveNewsDashboard/);
  assert.match(liveNews, /api\/live-news/);
  assert.match(liveNews, /navigator\.clipboard/);
  assert.match(theme, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(theme, /data-news-url/);
});

test('live news endpoint is wired without changing existing feature routes', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(app, /\/api\/live-news/);
  assert.match(app, /liveNews/);
});
