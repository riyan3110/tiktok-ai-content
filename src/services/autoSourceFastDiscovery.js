const defaultSourceFetcher = require('./sourceFetcher');
const baseDiscovery = require('./autoSourceDiscovery');
const { sourceFacts } = require('./manualSourceFallback');

const CACHE_TTL_MS = 10 * 60 * 1000;
const QUERY_CONCURRENCY = 3;
const FETCH_CONCURRENCY = 5;
const MAX_CANDIDATES = 32;
const MAX_FETCH_CANDIDATES = 20;
const MAX_SELECTED = 4;
const cache = new Map();

const QUERY_STOPWORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','terhadap','pada','ini','itu','baru','terbaru','aplikasi','fitur',
  'cara','akan','memberi','memberikan','membuat','buat','bisa','dapat','jadi','menjadi','pakai','menggunakan','hadir',
  'menghadirkan','bermitra','kemitraan','raksasa','potensi','manfaat','the','and','for','with','about','new','latest','app'
]);

const ENGLISH_REWRITES = [
  [/\bkecerdasan buatan\b/gi, 'artificial intelligence'],
  [/\bkeamanan siber\b/gi, 'cybersecurity'],
  [/\bbermitra dengan\b/gi, 'partners with'],
  [/\bbermitra\b/gi, 'partners'],
  [/\bkemitraan\b/gi, 'partnership'],
  [/\bmanfaat\b/gi, 'benefits'],
  [/\biklim\b/gi, 'climate'],
  [/\bcuaca\b/gi, 'weather'],
  [/\bpeluncuran\b/gi, 'launch'],
  [/\bdiluncurkan\b/gi, 'launched'],
  [/\bperusahaan\b/gi, 'company'],
  [/\bpengguna\b/gi, 'users'],
  [/\braksasa\b/gi, 'giant']
];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function mapLimit(items, limit, worker) {
  const values = Array.from(items || []);
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, () => run());
  await Promise.all(workers);
  return results;
}

function anchorQuery(topic) {
  return String(topic || '')
    .match(/[A-Za-z0-9][A-Za-z0-9.+-]*/g)?.filter(token => token.length > 2 && !QUERY_STOPWORDS.has(token.toLocaleLowerCase('id-ID')))
    .slice(0, 6).join(' ') || '';
}

function englishRewrite(topic) {
  let value = String(topic || '').trim();
  for (const [pattern, replacement] of ENGLISH_REWRITES) value = value.replace(pattern, replacement);
  return value.replace(/\s+/g, ' ').trim();
}

function expandedQueries(topic, category = '') {
  const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ');
  const base = baseDiscovery.searchQueries(cleanTopic, category);
  const anchors = anchorQuery(cleanTopic);
  const english = englishRewrite(cleanTopic);
  const extras = [
    anchors && anchors.toLocaleLowerCase('id-ID') !== cleanTopic.toLocaleLowerCase('id-ID') ? `${anchors} latest` : '',
    english && english.toLocaleLowerCase('id-ID') !== cleanTopic.toLocaleLowerCase('id-ID') ? english : '',
    english ? `${english} latest news` : '',
    anchors ? `${anchors} announcement partnership report` : ''
  ];
  return [...new Set([...base, ...extras].map(value => String(value || '').trim()).filter(Boolean))].slice(0, 7);
}

async function fastSearchWeb(query, options = {}) {
  const jobs = [];
  const add = (label, fn) => jobs.push((async () => {
    try { return await fn(); }
    catch (error) {
      console.warn(`[AutoSource] ${label} gagal:`, error.message);
      return [];
    }
  })());

  if (options.apiKey || process.env.JINA_API_KEY) add('Jina Search', () => baseDiscovery.searchJina(query, options));
  add('Bing News', () => baseDiscovery.searchBingNews(query, options));
  add('Bing Web', () => baseDiscovery.searchBingWeb(query, options));
  if (!/\b(?:berita|update|edukasi|teknologi|news|latest)\b/i.test(query)) {
    add('Wikipedia ID', () => baseDiscovery.searchWikipedia(query, { ...options, language: 'id' }));
    add('Wikipedia EN', () => baseDiscovery.searchWikipedia(query, { ...options, language: 'en' }));
  }

  const combined = (await Promise.all(jobs)).flat();
  const seen = new Set();
  return combined.filter(item => {
    const url = baseDiscovery.canonicalUrl(item?.url);
    if (!url || !baseDiscovery.candidateAllowed(url) || seen.has(url)) return false;
    seen.add(url);
    item.url = url;
    return true;
  });
}

function freshnessBoost(publishedAt, now = Date.now()) {
  const timestamp = Date.parse(String(publishedAt || ''));
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  if (ageDays <= 2) return 3;
  if (ageDays <= 7) return 2.25;
  if (ageDays <= 30) return 1.25;
  if (ageDays <= 120) return 0.4;
  if (ageDays > 730) return -1;
  return 0;
}

function fetchedScore(topic, source, candidate, factCount, now = Date.now()) {
  const titleRelevance = baseDiscovery.relevanceScore(topic, source?.title || '');
  const bodyRelevance = baseDiscovery.relevanceScore(topic, String(source?.text || '').slice(0, 5000));
  return baseDiscovery.candidateScore(topic, candidate)
    + titleRelevance * 5
    + bodyRelevance * 8
    + Math.min(12, factCount) * 0.25
    + freshnessBoost(candidate?.publishedAt, now);
}

function sourceHost(source) {
  try { return new URL(source?.finalUrl || source?.url).hostname.replace(/^www\./i, '').toLocaleLowerCase('en-US'); }
  catch { return ''; }
}

function selectDiverseSources(fetched = [], maxSelected = MAX_SELECTED) {
  const selected = [];
  const usedHosts = new Set();
  const bestScore = fetched[0]?.discovery?.score || 0;
  const eligible = fetched.filter(source => !(bestScore > 0 && source.discovery.score < bestScore * 0.4));

  // First pass: one article per publisher whenever possible.
  for (const source of eligible) {
    const host = sourceHost(source);
    if (!host || usedHosts.has(host)) continue;
    selected.push(source);
    usedHosts.add(host);
    if (selected.length >= maxSelected) return selected;
  }

  // Second pass: fill only when there are not enough distinct publishers.
  for (const source of eligible) {
    if (selected.includes(source)) continue;
    selected.push(source);
    if (selected.length >= maxSelected) break;
  }
  return selected;
}

async function discover({
  topic,
  category = '',
  searchImpl = fastSearchWeb,
  sourceFetcher = defaultSourceFetcher,
  fetchImpl = fetch,
  now = Date.now
} = {}) {
  const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ');
  if (!cleanTopic) throw Object.assign(new Error('Topik wajib diisi untuk pencarian sumber otomatis.'), { status: 400 });

  const key = `${cleanTopic.toLocaleLowerCase('id-ID')}|${String(category || '').toLocaleLowerCase('id-ID')}`;
  const cached = cache.get(key);
  if (cached && now() - cached.savedAt < CACHE_TTL_MS) return clone(cached.bundle);

  const queries = expandedQueries(cleanTopic, category);
  const groups = await mapLimit(queries, QUERY_CONCURRENCY, async query => {
    try {
      const results = await searchImpl(query, { fetchImpl });
      return (results || []).slice(0, 12).map(result => ({ ...result, query }));
    } catch (error) {
      console.warn(`[AutoSource] query gagal (${query}):`, error.message);
      return [];
    }
  });

  const unique = new Map();
  groups.flat().forEach(candidate => {
    const url = baseDiscovery.canonicalUrl(candidate?.url);
    if (!url || !baseDiscovery.candidateAllowed(url)) return;
    const value = {
      ...candidate,
      url,
      searchScore: baseDiscovery.candidateScore(cleanTopic, candidate) + freshnessBoost(candidate?.publishedAt, now())
    };
    if (!unique.has(url) || value.searchScore > unique.get(url).searchScore) unique.set(url, value);
  });

  const ranked = [...unique.values()]
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, MAX_CANDIDATES);
  if (!ranked.length) throw Object.assign(new Error('Tidak menemukan sumber publik yang relevan untuk topik ini.'), { status: 422, code: 'AUTO_SOURCE_SEARCH_EMPTY' });

  const minimumRelevance = baseDiscovery.minimumRelevantFraction(cleanTopic);
  const fetchedRows = await mapLimit(ranked.slice(0, MAX_FETCH_CANDIDATES), FETCH_CONCURRENCY, async candidate => {
    const source = await baseDiscovery.fetchCandidate(candidate, { sourceFetcher, fetchImpl });
    if (!source) return null;
    const combined = `${source.title || ''} ${String(source.text || '').slice(0, 6000)}`;
    const relevance = baseDiscovery.relevanceScore(cleanTopic, combined);
    const titleRelevance = baseDiscovery.relevanceScore(cleanTopic, source.title || '');
    const searchRelevance = Math.max(
      baseDiscovery.relevanceScore(cleanTopic, candidate.title),
      baseDiscovery.relevanceScore(cleanTopic, candidate.description)
    );
    if (relevance < minimumRelevance && titleRelevance < minimumRelevance && searchRelevance < minimumRelevance) return null;
    const factCount = sourceFacts([source]).length;
    if (factCount < 3) return null;
    return {
      ...source,
      discovery: {
        provider: candidate.provider,
        query: candidate.query,
        publishedAt: candidate.publishedAt || null,
        score: fetchedScore(cleanTopic, source, candidate, factCount, now()),
        relevance: Math.max(relevance, titleRelevance, searchRelevance),
        factCount
      }
    };
  });

  const fetched = fetchedRows.filter(Boolean).sort((a, b) => b.discovery.score - a.discovery.score);
  const selected = selectDiverseSources(fetched, MAX_SELECTED);

  if (!selected.length) {
    throw Object.assign(new Error('Sumber ditemukan, tetapi belum ada artikel yang cukup relevan, kaya fakta, dan dapat dibaca.'), { status: 422, code: 'AUTO_SOURCE_FETCH_EMPTY' });
  }

  const bundle = {
    topic: cleanTopic,
    searchedAt: new Date(now()).toISOString(),
    queries,
    providers: [...new Set(selected.map(source => source.discovery?.provider).filter(Boolean))],
    sources: selected
  };
  cache.set(key, { savedAt: now(), bundle: clone(bundle) });
  return bundle;
}

function clearCache() { cache.clear(); }

module.exports = {
  discover,
  fastSearchWeb,
  clearCache,
  mapLimit,
  expandedQueries,
  anchorQuery,
  englishRewrite,
  freshnessBoost,
  selectDiverseSources,
  QUERY_CONCURRENCY,
  FETCH_CONCURRENCY,
  CACHE_TTL_MS,
  MAX_CANDIDATES,
  MAX_FETCH_CANDIDATES,
  MAX_SELECTED
};
