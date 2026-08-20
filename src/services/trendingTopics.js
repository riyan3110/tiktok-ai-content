const config = require('../config');

const termsByCategory = {
  'Iklan & UGC': ['iklan', 'ugc', 'marketing', 'brand', 'produk', 'ai', 'canva', 'tiktok', 'video'],
  'Tutorial AI': ['ai', 'chatgpt', 'gemini', 'prompt', 'otomasi'],
  'Tips bisnis': ['bisnis', 'usaha', 'umkm', 'jualan', 'pelanggan'],
  Produktivitas: ['produktivitas', 'fokus', 'waktu', 'kerja', 'belajar'],
  'Fakta unik': ['fakta', 'unik', 'tahukah', 'sains', 'sejarah'],
  'Edukasi teknologi': ['teknologi', 'digital', 'software', 'gadget', 'internet'],
  Motivasi: ['motivasi', 'semangat', 'kebiasaan', 'mental', 'tujuan'],
  'Konten kreator': ['konten', 'kreator', 'editing', 'tiktok', 'video']
};

function topicText(item) {
  if (typeof item === 'string') return item.trim();
  return String(item?.topic || item?.title || item?.name || '').trim();
}

function relevantTopics(payload, category = 'Iklan & UGC') {
  const items = Array.isArray(payload) ? payload : payload?.topics || payload?.data || payload?.results || [];
  const nicheTerms = termsByCategory[category] || String(category).toLocaleLowerCase('id-ID').split(/\s+/).filter((term) => term.length > 2);
  return items.map(topicText).filter(Boolean).filter((topic) => {
    const lower = topic.toLocaleLowerCase('id-ID');
    return nicheTerms.some((term) => lower.includes(term));
  });
}

async function getLatest(category = 'Iklan & UGC', fetchImpl = fetch) {
  if (typeof category === 'function') { fetchImpl = category; category = 'Iklan & UGC'; }
  if (!config.trendingApiUrl) return [];
  const headers = { Accept: 'application/json' };
  if (config.trendingApiKey) {
    headers.Authorization = `Bearer ${config.trendingApiKey}`;
    headers['X-API-Key'] = config.trendingApiKey;
  }
  const url = new URL(config.trendingApiUrl);
  url.searchParams.set('category', category);
  const response = await fetchImpl(url, { headers });
  if (!response.ok) throw new Error(`Trending API HTTP ${response.status}`);
  return relevantTopics(await response.json(), category);
}

module.exports = { getLatest, relevantTopics };
