const defaultSourceFetcher = require('./sourceFetcher');
const baseDiscovery = require('./autoSourceDiscovery');
const fastDiscovery = require('./autoSourceFastDiscovery');
const { sourceFacts } = require('./manualSourceFallback');

// TANPA URL / AUTO SOURCE ONLY.
// This module is loaded only after autoSourcePatch has already excluded Pakai URL.
const CACHE_TTL_MS = 10 * 60 * 1000;
const QUERY_CONCURRENCY = 3;
const FETCH_CONCURRENCY = 6;
const MAX_CANDIDATES = 32;
const MAX_FETCH_CANDIDATES = 20;
const MAX_SELECTED = 4;
const MIN_FACTS_PER_SOURCE = 5;
const SEARCH_TIMEOUT_MS = 10_000;
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
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), values.length) }, () => run()));
  return results;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchWithTimeout(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try { return await fetchImpl(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function parseRssItems(xml, provider) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
    const item = match[1];
    const read = tag => decodeXml(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '');
    return {
      title: read('title'),
      url: baseDiscovery.canonicalUrl(read('link')),
      description: read('description'),
      publishedAt: read('pubDate') || null,
      provider
    };
  }).filter(item => item.url && baseDiscovery.candidateAllowed(item.url));
}

async function searchBingEnglish(query, { fetchImpl = fetch, kind = 'news' } = {}) {
  const isNews = kind === 'news';
  const endpoint = isNews ? 'https://www.bing.com/news/search' : 'https://www.bing.com/search';
  const provider = isNews ? 'bing-news-en' : 'bing-web-en';
  const url = `${endpoint}?q=${encodeURIComponent(query)}&format=rss&setlang=en-US&cc=US`;
  const response = await fetchWithTimeout(fetchImpl, url, {
    headers: {
      'User-Agent': 'AIAdsLabAutoSource/1.2',
      Accept: 'application/rss+xml,text/xml;q=0.9,*/*;q=0.1'
    }
  });
  if (!response.ok) throw new Error(`Bing ${isNews ? 'News' : 'Web'} EN HTTP ${response.status}`);
  return parseRssItems(await response.text(), provider);
}

async function expandedSearchWeb(query, options = {}) {
  const jobs = [
    ['existing providers', () => fastDiscovery.fastSearchWeb(query, options)],
    ['Bing News EN', () => searchBingEnglish(query, { ...options, kind: 'news' })],
    ['Bing Web EN', () => searchBingEnglish(query, { ...options, kind: 'web' })]
  ];
  const groups = await Promise.all(jobs.map(async ([label, run]) => {
    try { return await run(); }
    catch (error) {
      console.warn(`[AutoSource] ${label} gagal:`, error.message);
      return [];
    }
  }));

  const seen = new Set();
  return groups.flat().filter(item => {
    const url = baseDiscovery.canonicalUrl(item?.url);
    if (!url || !baseDiscovery.candidateAllowed(url) || seen.has(url)) return false;
    seen.add(url);
    item.url = url;
    return true;
  });
}

function expandedQueries(topic, category = '') {
  const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ');
  const base = baseDiscovery.searchQueries(cleanTopic, category);
  const values = [
    ...base,
    `${cleanTopic} terbaru`,
    `${cleanTopic} latest`,
    `${cleanTopic} official`,
    `${cleanTopic} research report`
  ];
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 6);
}

function freshnessScore(publishedAt, nowMs = Date.now()) {
  if (!publishedAt) return 0;
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = (nowMs - timestamp) / 86_400_000;
  if (ageDays < -2) return -1;
  if (ageDays <= 2) return 3;
  if (ageDays <= 7) return 2.5;
  if (ageDays <= 30) return 1.8;
  if (ageDays <= 90) return 1;
  if (ageDays <= 365) return 0.35;
  if (ageDays > 730) return -0.5;
  return 0;
}

function publisherKey(raw) {
  try {
    let host = new URL(raw).hostname.toLocaleLowerCase('en-US')
      .replace(/^www\d*\./, '').replace(/^m\./, '').replace(/^amp\./, '');
    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join('.');
    const multiPartSuffix = new Set(['co.id', 'co.uk', 'com.au', 'com.sg', 'co.jp', 'co.kr']);
    return multiPartSuffix.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
  } catch { return ''; }
}

function candidateScore(topic, candidate, nowMs) {
  return baseDiscovery.candidateScore(topic, candidate) + freshnessScore(candidate?.publishedAt, nowMs);
}

function fetchedScore(topic, source, candidate, factCount, nowMs) {
  const titleRelevance = baseDiscovery.relevanceScore(topic, source?.title || '');
  const bodyRelevance = baseDiscovery.relevanceScore(topic, String(source?.text || '').slice(0, 7000));
  return candidateScore(topic, candidate, nowMs)
    + titleRelevance * 6
    + bodyRelevance * 10
    + Math.min(16, factCount) * 0.3;
}

function fetchedContentRelevant(topic, source) {
  const minimum = baseDiscovery.minimumRelevantFraction(topic);
  const titleRelevance = baseDiscovery.relevanceScore(topic, source?.title || '');
  const bodyRelevance = baseDiscovery.relevanceScore(topic, `${source?.title || ''} ${String(source?.text || '').slice(0, 9000)}`);
  // Search-result snippets may be stale or misleading. The fetched article itself
  // must satisfy the topic gate before it can become a selected source.
  return Math.max(titleRelevance, bodyRelevance) >= minimum;
}

async function discover({
  topic,
  category = '',
  searchImpl = expandedSearchWeb,
  sourceFetcher = defaultSourceFetcher,
  fetchImpl = fetch,
  now = Date.now
} = {}) {
  const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ');
  if (!cleanTopic) throw Object.assign(new Error('Topik wajib diisi untuk pencarian sumber otomatis.'), { status: 400 });

  const nowMs = now();
  const cacheKey = `${cleanTopic.toLocaleLowerCase('id-ID')}|${String(category || '').toLocaleLowerCase('id-ID')}`;
  const cached = cache.get(cacheKey);
  if (cached && nowMs - cached.savedAt < CACHE_TTL_MS) return clone(cached.bundle);

  const queries = expandedQueries(cleanTopic, category);
  const groups = await mapLimit(queries, QUERY_CONCURRENCY, async query => {
    try {
      const rows = await searchImpl(query, { fetchImpl });
      return (rows || []).slice(0, 14).map(row => ({ ...row, query }));
    } catch (error) {
      console.warn(`[AutoSource] query gagal (${query}):`, error.message);
      return [];
    }
  });

  const unique = new Map();
  groups.flat().forEach(candidate => {
    const url = baseDiscovery.canonicalUrl(candidate?.url);
    if (!url || !baseDiscovery.candidateAllowed(url)) return;
    const value = { ...candidate, url, searchScore: candidateScore(cleanTopic, candidate, nowMs) };
    if (!unique.has(url) || value.searchScore > unique.get(url).searchScore) unique.set(url, value);
  });

  const ranked = [...unique.values()]
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, MAX_CANDIDATES);
  if (!ranked.length) {
    throw Object.assign(new Error('Tidak menemukan sumber publik yang relevan untuk topik ini.'), { status: 422, code: 'AUTO_SOURCE_SEARCH_EMPTY' });
  }

  const fetchedRows = await mapLimit(ranked.slice(0, MAX_FETCH_CANDIDATES), FETCH_CONCURRENCY, async candidate => {
    const source = await baseDiscovery.fetchCandidate(candidate, { sourceFetcher, fetchImpl });
    if (!source || !fetchedContentRelevant(cleanTopic, source)) return null;
    const facts = sourceFacts([source]);
    if (facts.length < MIN_FACTS_PER_SOURCE) return null;
    return {
      ...source,
      publishedAt: source.publishedAt || candidate.publishedAt || null,
      discovery: {
        provider: candidate.provider,
        query: candidate.query,
        score: fetchedScore(cleanTopic, source, candidate, facts.length, nowMs),
        relevance: Math.max(
          baseDiscovery.relevanceScore(cleanTopic, source.title || ''),
          baseDiscovery.relevanceScore(cleanTopic, `${source.title || ''} ${String(source.text || '').slice(0, 9000)}`)
        ),
        factCount: facts.length,
        publishedAt: source.publishedAt || candidate.publishedAt || null,
        publisher: publisherKey(source.finalUrl || source.url)
      }
    };
  });

  const fetched = fetchedRows.filter(Boolean).sort((a, b) => b.discovery.score - a.discovery.score);
  const selected = [];
  const publishers = new Set();
  const bestScore = fetched[0]?.discovery?.score || 0;

  // Hard diversity preference: at most one selected article per publisher.
  // We would rather use fewer strong independent sources than three articles
  // from one site that repeat the same editorial context.
  for (const source of fetched) {
    if (selected.length && bestScore > 0 && source.discovery.score < bestScore * 0.35) continue;
    const publisher = source.discovery?.publisher || publisherKey(source.finalUrl || source.url);
    if (!publisher || publishers.has(publisher)) continue;
    selected.push(source);
    publishers.add(publisher);
    if (selected.length >= MAX_SELECTED) break;
  }

  if (!selected.length) {
    throw Object.assign(new Error('Sumber ditemukan, tetapi belum ada artikel yang cukup relevan, kaya fakta, dapat dibaca, dan layak dipakai.'), { status: 422, code: 'AUTO_SOURCE_FETCH_EMPTY' });
  }

  const bundle = {
    topic: cleanTopic,
    searchedAt: new Date(nowMs).toISOString(),
    queries,
    providers: [...new Set(selected.map(source => source.discovery?.provider).filter(Boolean))],
    publishers: [...publishers],
    sources: selected
  };
  cache.set(cacheKey, { savedAt: nowMs, bundle: clone(bundle) });
  return bundle;
}

function clearCache() { cache.clear(); }

module.exports = {
  discover,
  expandedSearchWeb,
  searchBingEnglish,
  expandedQueries,
  freshnessScore,
  publisherKey,
  fetchedContentRelevant,
  clearCache,
  CACHE_TTL_MS,
  QUERY_CONCURRENCY,
  FETCH_CONCURRENCY,
  MAX_CANDIDATES,
  MAX_FETCH_CANDIDATES,
  MAX_SELECTED,
  MIN_FACTS_PER_SOURCE
};