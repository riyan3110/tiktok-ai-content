const https = require('node:https');
const http = require('node:http');

const FEEDS = [
  'https://www.antaranews.com/rss/terkini.xml',
  'https://rss.detik.com/index.php/detikcom',
  'https://www.cnnindonesia.com/nasional/rss',
  'https://www.cnnindonesia.com/teknologi/rss',
  'https://inet.detik.com/rss'
];
const CACHE_MS = 5 * 60 * 1000;
let cache = { expiresAt: 0, items: [] };

function decode(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const match = String(block).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return decode(match?.[1] || '');
}
function parseFeedXml(xml) {
  return [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(match => {
    const block = match[1];
    const enclosure = block.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1] || '';
    const media = block.match(/<(?:media:content|media:thumbnail)\b[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1] || '';
    const title = tag(block, 'title');
    const url = tag(block, 'link');
    return { title, url, image: enclosure || media, summary: tag(block, 'description'), publishedAt: tag(block, 'pubDate') || tag(block, 'dc:date') };
  }).filter(item => item.title && /^https?:\/\//i.test(item.url));
}
function request(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { headers: { 'User-Agent': 'AIAdsLabLiveNews/1.0', Accept: 'application/rss+xml, application/xml, text/xml' } }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); return reject(new Error(`RSS HTTP ${response.statusCode}`)); }
      const chunks = []; response.setEncoding('utf8');
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(chunks.join('')));
    });
    request.setTimeout(8000, () => request.destroy(new Error('RSS timeout')));
    request.on('error', reject);
  });
}
async function listLiveNews() {
  if (cache.expiresAt > Date.now()) return cache.items;
  const results = await Promise.allSettled(FEEDS.map(request));
  const feeds = results.map(result => result.status === 'fulfilled' ? parseFeedXml(result.value) : []);
  const seen = new Set();
  const items = [];
  const maxLen = feeds.reduce((max, feed) => Math.max(max, feed.length), 0);
  for (let round = 0; round < maxLen && items.length < 12; round += 1) {
    for (const feed of feeds) {
      const item = feed[round];
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
      if (items.length >= 12) break;
    }
  }
  if (items.length) cache = { items, expiresAt: Date.now() + CACHE_MS };
  return cache.items;
}
module.exports = { FEEDS, parseFeedXml, listLiveNews };
