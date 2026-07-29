const config = require('../config');

const nicheTerms = ['ai', 'iklan', 'ugc', 'editing', 'editor', 'konten', 'kreator', 'tiktok', 'canva', 'video'];

function topicText(item) {
  if (typeof item === 'string') return item.trim();
  return String(item?.topic || item?.title || item?.name || '').trim();
}

function relevantTopics(payload) {
  const items = Array.isArray(payload) ? payload : payload?.topics || payload?.data || payload?.results || [];
  return items.map(topicText).filter(Boolean).filter((topic) => {
    const lower = topic.toLocaleLowerCase('id-ID');
    return nicheTerms.some((term) => lower.includes(term));
  });
}

async function getLatest(fetchImpl = fetch) {
  if (!config.trendingApiUrl) return [];
  const headers = { Accept: 'application/json' };
  if (config.trendingApiKey) {
    headers.Authorization = `Bearer ${config.trendingApiKey}`;
    headers['X-API-Key'] = config.trendingApiKey;
  }
  const response = await fetchImpl(config.trendingApiUrl, { headers });
  if (!response.ok) throw new Error(`Trending API HTTP ${response.status}`);
  return relevantTopics(await response.json());
}

module.exports = { getLatest, relevantTopics };
