const defaultSourceFetcher = require('./sourceFetcher');

const CACHE_TTL_MS = 45 * 60 * 1000;
const MAX_CANDIDATES = 8;
const MAX_FETCH_CANDIDATES = 6;
const MAX_SELECTED = 3;
const SEARCH_TIMEOUT_MS = 10_000;
const cache = new Map();

const STOP_WORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','ini','itu','baru','terbaru','aplikasi','fitur','cara','the','and','for','with','about','new','latest','app'
]);
const LOW_VALUE_HOSTS = /(?:facebook\.com|instagram\.com|tiktok\.com|pinterest\.|linkedin\.com|x\.com|twitter\.com|youtube\.com|youtu\.be)$/i;
const LOW_VALUE_PATH = /\/(?:search|tag|tags|category|categories|topics?|author|login|signup|account)(?:\/|$)/i;
const QUALITY_HOSTS = [
  /(^|\.)reuters\.com$/i, /(^|\.)apnews\.com$/i, /(^|\.)techcrunch\.com$/i,
  /(^|\.)theverge\.com$/i, /(^|\.)arstechnica\.com$/i, /(^|\.)wired\.com$/i,
  /(^|\.)bloomberg\.com$/i, /(^|\.)bloombergtechnoz\.com$/i, /(^|\.)cnet\.com$/i,
  /(^|\.)zdnet\.com$/i, /(^|\.)github\.com$/i, /(^|\.)openai\.com$/i,
  /(^|\.)anthropic\.com$/i, /(^|\.)google\.com$/i, /(^|\.)blog\.google$/i,
  /(^|\.)microsoft\.com$/i, /(^|\.)apple\.com$/i, /(^|\.)meta\.com$/i
];

function normalized(value) {
  return String(value || '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(value) {
  return [...new Set(normalized(value).split(/\s+/).filter(token => token.length > 2 && !STOP_WORDS.has(token)))];
}
function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function canonicalUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(key => url.searchParams.delete(key));
    return url.href.replace(/\/$/, '');
  } catch { return null; }
}
function candidateAllowed(raw) {
  const canonical = canonicalUrl(raw);
  if (!canonical) return false;
  const url = new URL(canonical);
  if (LOW_VALUE_HOSTS.test(url.hostname) || LOW_VALUE_PATH.test(url.pathname)) return false;
  if (url.pathname === '/' && !/\.(?:gov|edu)$/i.test(url.hostname)) return false;
  return true;
}
function hostQuality(raw, topic) {
  try {
    const host = new URL(raw).hostname.toLocaleLowerCase('en-US');
    let score = QUALITY_HOSTS.some(pattern => pattern.test(host)) ? 2 : 0;
    const topicTokens = tokens(topic).filter(token => token.length >= 5);
    if (topicTokens.some(token => host.includes(token))) score += 2;
    if (/\.(?:gov|edu)$/i.test(host)) score += 1.5;
    return score;
  } catch { return 0; }
}
function relevanceScore(topic, value) {
  const wanted = tokens(topic);
  if (!wanted.length) return 0;
  const haystack = normalized(value);
  const overlap = wanted.filter(token => haystack.includes(token)).length;
  return overlap / wanted.length;
}
function candidateScore(topic, candidate) {
  const titleScore = relevanceScore(topic, candidate.title) * 5;
  const descriptionScore = relevanceScore(topic, candidate.description) * 2;
  return titleScore + descriptionScore + hostQuality(candidate.url, topic);
}
function fetchedScore(topic, source, candidate) {
  return candidateScore(topic, candidate) + relevanceScore(topic, `${source.title || ''} ${String(source.text || '').slice(0, 2500)}`) * 7;
}
function searchQueries(topic, category = '') {
  const values = [String(topic || '').trim(), `${String(topic || '').trim()} ${String(category || '').trim()}`.trim()];
  return [...new Set(values.filter(Boolean))].slice(0, 2);
}

async function fetchWithTimeout(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try { return await fetchImpl(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function searchJina(query, { fetchImpl = fetch, apiKey = process.env.JINA_API_KEY } = {}) {
  if (!apiKey) return [];
  const url = `https://s.jina.ai/?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(fetchImpl, url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'X-Retain-Images': 'none',
      'X-Timeout': '8'
    }
  });
  if (!response.ok) throw new Error(`Jina Search HTTP ${response.status}`);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map(item => ({
    title: String(item?.title || '').trim(),
    url: canonicalUrl(item?.url),
    description: String(item?.description || '').trim(),
    publishedAt: item?.publishedTime || item?.date || null,
    provider: 'jina'
  })).filter(item => item.url && candidateAllowed(item.url));
}

async function searchBingNews(query, { fetchImpl = fetch } = {}) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&setlang=id-ID`;
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { 'User-Agent': 'AIAdsLabAutoSource/1.0', Accept: 'application/rss+xml,text/xml;q=0.9,*/*;q=0.1' } });
  if (!response.ok) throw new Error(`Bing News HTTP ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => {
    const item = match[1];
    const read = tag => decodeXml(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '');
    const rawUrl = read('link');
    return {
      title: read('title'), url: canonicalUrl(rawUrl), description: read('description'),
      publishedAt: read('pubDate') || null, provider: 'bing-news'
    };
  }).filter(item => item.url && candidateAllowed(item.url));
}

async function searchWeb(query, options = {}) {
  const combined = [];
  if (options.apiKey || process.env.JINA_API_KEY) {
    try { combined.push(...await searchJina(query, options)); } catch (error) { console.warn('[AutoSource] Jina Search gagal:', error.message); }
  }
  if (combined.length < 4) {
    try { combined.push(...await searchBingNews(query, options)); } catch (error) { console.warn('[AutoSource] Bing News gagal:', error.message); }
  }
  const seen = new Set();
  return combined.filter(item => {
    const key = canonicalUrl(item.url);
    if (!key || seen.has(key)) return false;
    seen.add(key); item.url = key; return true;
  });
}

function stripReaderMarkdown(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/`{1,3}/g, '')
    .replace(/\s+/g, ' ').trim();
}
async function fetchViaJinaReader(rawUrl, { fetchImpl = fetch, sourceFetcher = defaultSourceFetcher } = {}) {
  const validated = sourceFetcher.validateUrl ? await sourceFetcher.validateUrl(rawUrl) : new URL(rawUrl);
  const headers = { Accept: 'application/json', 'X-Retain-Images': 'none', 'X-Timeout': '8' };
  if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  const response = await fetchWithTimeout(fetchImpl, `https://r.jina.ai/${validated.href}`, { headers });
  if (!response.ok) throw new Error(`Jina Reader HTTP ${response.status}`);
  const payload = await response.json();
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const text = stripReaderMarkdown(data?.content || data?.text || '');
  if (text.length < 250) throw new Error('Isi Jina Reader terlalu pendek');
  return {
    url: rawUrl,
    finalUrl: canonicalUrl(data?.url || validated.href) || validated.href,
    title: String(data?.title || '').trim(),
    text: text.slice(0, 12000),
    fetchedAt: new Date().toISOString()
  };
}
async function fetchCandidate(candidate, { sourceFetcher = defaultSourceFetcher, fetchImpl = fetch } = {}) {
  try {
    const [source] = await sourceFetcher.fetchSources([candidate.url]);
    return source;
  } catch (directError) {
    try { return await fetchViaJinaReader(candidate.url, { fetchImpl, sourceFetcher }); }
    catch (readerError) {
      console.warn('[AutoSource] kandidat gagal dibaca:', candidate.url, directError.message, readerError.message);
      return null;
    }
  }
}
function cloneBundle(bundle) { return JSON.parse(JSON.stringify(bundle)); }

async function discover({ topic, category = '', searchImpl = searchWeb, sourceFetcher = defaultSourceFetcher, fetchImpl = fetch, now = Date.now } = {}) {
  const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ');
  if (!cleanTopic) throw Object.assign(new Error('Topik wajib diisi untuk pencarian sumber otomatis.'), { status: 400 });
  const key = `${normalized(cleanTopic)}|${normalized(category)}`;
  const cached = cache.get(key);
  if (cached && now() - cached.savedAt < CACHE_TTL_MS) return cloneBundle(cached.bundle);

  const queries = searchQueries(cleanTopic, category);
  const candidates = [];
  for (const query of queries) {
    const results = await searchImpl(query, { fetchImpl });
    candidates.push(...results.map(result => ({ ...result, query })));
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  const unique = new Map();
  candidates.forEach(candidate => {
    const url = canonicalUrl(candidate.url);
    if (!url || !candidateAllowed(url)) return;
    const value = { ...candidate, url, searchScore: candidateScore(cleanTopic, candidate) };
    if (!unique.has(url) || value.searchScore > unique.get(url).searchScore) unique.set(url, value);
  });
  const ranked = [...unique.values()].sort((a, b) => b.searchScore - a.searchScore).slice(0, MAX_CANDIDATES);
  if (!ranked.length) throw Object.assign(new Error('Tidak menemukan sumber publik yang relevan untuk topik ini.'), { status: 422, code: 'AUTO_SOURCE_SEARCH_EMPTY' });

  const topicTokenCount = tokens(cleanTopic).length;
  const minimumRelevance = topicTokenCount <= 1 ? 1 : 0.66;
  const fetched = [];
  for (const candidate of ranked.slice(0, MAX_FETCH_CANDIDATES)) {
    const source = await fetchCandidate(candidate, { sourceFetcher, fetchImpl });
    if (!source) continue;
    const score = fetchedScore(cleanTopic, source, candidate);
    if (relevanceScore(cleanTopic, `${source.title || ''} ${String(source.text || '').slice(0, 3500)}`) < minimumRelevance) continue;
    fetched.push({ ...source, discovery: { provider: candidate.provider, query: candidate.query, score } });
  }
  fetched.sort((a, b) => b.discovery.score - a.discovery.score);
  const selected = [];
  const usedHosts = new Set();
  for (const source of fetched) {
    let host = '';
    try { host = new URL(source.finalUrl || source.url).hostname; } catch {}
    if (selected.length < 2 && host && usedHosts.has(host) && fetched.some(other => {
      try { return new URL(other.finalUrl || other.url).hostname !== host && !usedHosts.has(new URL(other.finalUrl || other.url).hostname); } catch { return false; }
    })) continue;
    selected.push(source);
    if (host) usedHosts.add(host);
    if (selected.length >= MAX_SELECTED) break;
  }
  if (!selected.length) throw Object.assign(new Error('Sumber ditemukan, tetapi tidak ada artikel yang cukup relevan dan dapat dibaca.'), { status: 422, code: 'AUTO_SOURCE_FETCH_EMPTY' });

  const bundle = {
    topic: cleanTopic,
    searchedAt: new Date(now()).toISOString(),
    queries,
    providers: [...new Set(selected.map(source => source.discovery?.provider).filter(Boolean))],
    sources: selected
  };
  cache.set(key, { savedAt: now(), bundle: cloneBundle(bundle) });
  return bundle;
}

function clearCache() { cache.clear(); }

module.exports = {
  discover, searchWeb, searchJina, searchBingNews, searchQueries, candidateAllowed, canonicalUrl,
  relevanceScore, candidateScore, fetchCandidate, fetchViaJinaReader, clearCache,
  CACHE_TTL_MS, MAX_CANDIDATES, MAX_FETCH_CANDIDATES, MAX_SELECTED
};
