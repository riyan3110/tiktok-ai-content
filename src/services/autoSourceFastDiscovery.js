const defaultSourceFetcher = require('./sourceFetcher');
const baseDiscovery = require('./autoSourceDiscovery');
const { sourceFacts } = require('./manualSourceFallback');

const CACHE_TTL_MS = 30 * 60 * 1000;
const QUERY_CONCURRENCY = 2;
const FETCH_CONCURRENCY = 4;
const cache = new Map();

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
  if (!/\b(?:berita|update|edukasi|teknologi)\b/i.test(query)) {
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

function fetchedScore(topic, source, candidate, factCount) {
  const titleRelevance = baseDiscovery.relevanceScore(topic, source?.title || '');
  const bodyRelevance = baseDiscovery.relevanceScore(topic, String(source?.text || '').slice(0, 5000));
  return baseDiscovery.candidateScore(topic, candidate) + titleRelevance * 5 + bodyRelevance * 8 + Math.min(12, factCount) * 0.25;
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

  const queries = baseDiscovery.searchQueries(cleanTopic, category);
  const groups = await mapLimit(queries, QUERY_CONCURRENCY, async query => {
    try {
      const results = await searchImpl(query, { fetchImpl });
      return (results || []).slice(0, 10).map(result => ({ ...result, query }));
    } catch (error) {
      console.warn(`[AutoSource] query gagal (${query}):`, error.message);
      return [];
    }
  });

  const unique = new Map();
  groups.flat().forEach(candidate => {
    const url = baseDiscovery.canonicalUrl(candidate?.url);
    if (!url || !baseDiscovery.candidateAllowed(url)) return;
    const value = { ...candidate, url, searchScore: baseDiscovery.candidateScore(cleanTopic, candidate) };
    if (!unique.has(url) || value.searchScore > unique.get(url).searchScore) unique.set(url, value);
  });

  const ranked = [...unique.values()]
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, baseDiscovery.MAX_CANDIDATES);
  if (!ranked.length) throw Object.assign(new Error('Tidak menemukan sumber publik yang relevan untuk topik ini.'), { status: 422, code: 'AUTO_SOURCE_SEARCH_EMPTY' });

  const minimumRelevance = baseDiscovery.minimumRelevantFraction(cleanTopic);
  const fetchedRows = await mapLimit(ranked.slice(0, baseDiscovery.MAX_FETCH_CANDIDATES), FETCH_CONCURRENCY, async candidate => {
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
        score: fetchedScore(cleanTopic, source, candidate, factCount),
        relevance: Math.max(relevance, titleRelevance, searchRelevance),
        factCount
      }
    };
  });

  const fetched = fetchedRows.filter(Boolean).sort((a, b) => b.discovery.score - a.discovery.score);
  const selected = [];
  const usedHosts = new Set();
  const bestScore = fetched[0]?.discovery?.score || 0;
  for (const source of fetched) {
    if (selected.length && bestScore > 0 && source.discovery.score < bestScore * 0.45) continue;
    let host = '';
    try { host = new URL(source.finalUrl || source.url).hostname; } catch {}
    if (!host) continue;
    const alternative = fetched.some(other => {
      try {
        const otherHost = new URL(other.finalUrl || other.url).hostname;
        return otherHost !== host && !usedHosts.has(otherHost);
      } catch { return false; }
    });
    if (usedHosts.has(host) && alternative && selected.length < 2) continue;
    selected.push(source);
    usedHosts.add(host);
    if (selected.length >= baseDiscovery.MAX_SELECTED) break;
  }

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
  QUERY_CONCURRENCY,
  FETCH_CONCURRENCY,
  CACHE_TTL_MS
};
