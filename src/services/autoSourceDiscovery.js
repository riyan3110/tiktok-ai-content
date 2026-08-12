const defaultSourceFetcher = require('./sourceFetcher');
const { sourceFacts } = require('./manualSourceFallback');

const CACHE_TTL_MS = 45 * 60 * 1000;
const MAX_CANDIDATES = 18;
const MAX_FETCH_CANDIDATES = 10;
const MAX_SELECTED = 3;
const SEARCH_TIMEOUT_MS = 10_000;
const cache = new Map();

const STOP_WORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','ini','itu','baru','terbaru','aplikasi','fitur','cara',
  'akan','memberi','memberikan','membuat','buat','bisa','dapat','jadi','menjadi','pakai','menggunakan','hadir','menghadirkan',
  'the','and','for','with','about','new','latest','app','will','give','gives','giving','make','makes','can','could','become','becomes','use','uses','using'
]);
const LOW_VALUE_HOSTS = /(?:facebook\.com|instagram\.com|tiktok\.com|pinterest\.|linkedin\.com|x\.com|twitter\.com|youtube\.com|youtu\.be|bing\.com)$/i;
const LOW_VALUE_PATH = /\/(?:search|tag|tags|category|categories|topics?|author|login|signup|account)(?:\/|$)/i;
const QUALITY_HOSTS = [
  /(^|\.)reuters\.com$/i, /(^|\.)apnews\.com$/i, /(^|\.)techcrunch\.com$/i,
  /(^|\.)theverge\.com$/i, /(^|\.)arstechnica\.com$/i, /(^|\.)wired\.com$/i,
  /(^|\.)bloomberg\.com$/i, /(^|\.)bloombergtechnoz\.com$/i, /(^|\.)cnet\.com$/i,
  /(^|\.)zdnet\.com$/i, /(^|\.)github\.com$/i, /(^|\.)openai\.com$/i,
  /(^|\.)anthropic\.com$/i, /(^|\.)google\.com$/i, /(^|\.)blog\.google$/i,
  /(^|\.)microsoft\.com$/i, /(^|\.)apple\.com$/i, /(^|\.)meta\.com$/i,
  /(^|\.)nature\.com$/i, /(^|\.)science\.org$/i, /(^|\.)ieee\.org$/i
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
function unwrapKnownRedirect(raw) {
  let value = String(raw || '').trim();
  for (let depth = 0; depth < 3; depth += 1) {
    let url;
    try { url = new URL(value); } catch { return value; }
    if (/(^|\.)bing\.com$/i.test(url.hostname)) {
      const target = url.searchParams.get('url');
      if (!target || !/^https?:\/\//i.test(target)) return value;
      value = target;
      continue;
    }
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname)) {
      const target = url.searchParams.get('uddg');
      if (!target || !/^https?:\/\//i.test(target)) return value;
      value = target;
      continue;
    }
    return value;
  }
  return value;
}
function canonicalUrl(raw) {
  try {
    const url = new URL(unwrapKnownRedirect(raw));
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
function providerBoost(provider) {
  if (provider === 'jina') return 1.5;
  if (provider === 'bing-news') return 1.25;
  if (provider === 'bing-web') return 0.9;
  if (provider === 'wikipedia-id') return 0.45;
  if (provider === 'wikipedia-en') return 0.35;
  return 0;
}
function hostQuality(raw, topic) {
  try {
    const host = new URL(canonicalUrl(raw) || raw).hostname.toLocaleLowerCase('en-US');
    let score = QUALITY_HOSTS.some(pattern => pattern.test(host)) ? 2 : 0;
    const topicTokens = tokens(topic).filter(token => token.length >= 5);
    if (topicTokens.some(token => host.includes(token))) score += 2;
    if (/\.(?:gov|edu)$/i.test(host)) score += 1.5;
    if (/(^|\.)wikipedia\.org$/i.test(host)) score += 0.4;
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
  const titleScore = relevanceScore(topic, candidate.title) * 6;
  const descriptionScore = relevanceScore(topic, candidate.description) * 2.5;
  return titleScore + descriptionScore + hostQuality(candidate.url, topic) + providerBoost(candidate.provider);
}
function fetchedScore(topic, source, candidate, factCount = 0) {
  const titleRelevance = relevanceScore(topic, source.title || '');
  const bodyRelevance = relevanceScore(topic, String(source.text || '').slice(0, 5000));
  const richnessBoost = Math.min(12, factCount) * 0.25;
  return candidateScore(topic, candidate) + titleRelevance * 5 + bodyRelevance * 8 + richnessBoost;
}
function searchQueries(topic, category = '') {
  const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ');
  const cleanCategory = String(category || '').trim().replace(/\s+/g, ' ');
  const anchorTokens = tokens(cleanTopic);
  const anchors = anchorTokens.join(' ');
  const reversedAnchors = anchorTokens.length === 2 ? [...anchorTokens].reverse().join(' ') : '';
  const values = [
    cleanTopic,
    anchors && anchors !== normalized(cleanTopic) ? anchors : '',
    reversedAnchors && reversedAnchors !== normalized(cleanTopic) && reversedAnchors !== anchors ? reversedAnchors : '',
    cleanCategory ? `${cleanTopic} ${cleanCategory}` : '',
    `${cleanTopic} berita update`
  ];
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 4);
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
    const rawUrl = read('link');
    return {
      title: read('title'),
      url: canonicalUrl(rawUrl),
      description: read('description'),
      publishedAt: read('pubDate') || null,
      provider
    };
  }).filter(item => item.url && candidateAllowed(item.url));
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
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { 'User-Agent': 'AIAdsLabAutoSource/1.1', Accept: 'application/rss+xml,text/xml;q=0.9,*/*;q=0.1' } });
  if (!response.ok) throw new Error(`Bing News HTTP ${response.status}`);
  return parseRssItems(await response.text(), 'bing-news');
}

async function searchBingWeb(query, { fetchImpl = fetch } = {}) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&setlang=id-ID`;
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { 'User-Agent': 'AIAdsLabAutoSource/1.1', Accept: 'application/rss+xml,text/xml;q=0.9,*/*;q=0.1' } });
  if (!response.ok) throw new Error(`Bing Web HTTP ${response.status}`);
  return parseRssItems(await response.text(), 'bing-web');
}

async function searchWikipedia(query, { fetchImpl = fetch, language = 'id' } = {}) {
  const endpoint = `https://${language}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json&origin=*`;
  const response = await fetchWithTimeout(fetchImpl, endpoint, { headers: { 'User-Agent': 'AIAdsLabAutoSource/1.1', Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Wikipedia ${language} HTTP ${response.status}`);
  const payload = await response.json();
  const titles = Array.isArray(payload?.[1]) ? payload[1] : [];
  const descriptions = Array.isArray(payload?.[2]) ? payload[2] : [];
  const urls = Array.isArray(payload?.[3]) ? payload[3] : [];
  return urls.map((rawUrl, index) => ({
    title: String(titles[index] || '').trim(),
    url: canonicalUrl(rawUrl),
    description: String(descriptions[index] || '').trim(),
    publishedAt: null,
    provider: language === 'id' ? 'wikipedia-id' : 'wikipedia-en'
  })).filter(item => item.url && candidateAllowed(item.url));
}

async function searchWeb(query, options = {}) {
  const combined = [];
  const add = async (label, fn) => {
    try { combined.push(...await fn()); }
    catch (error) { console.warn(`[AutoSource] ${label} gagal:`, error.message); }
  };
  if (options.apiKey || process.env.JINA_API_KEY) await add('Jina Search', () => searchJina(query, options));
  await add('Bing News', () => searchBingNews(query, options));
  await add('Bing Web', () => searchBingWeb(query, options));
  const referenceFriendly = !/\b(?:berita|update|edukasi|teknologi)\b/i.test(query);
  if (referenceFriendly) {
    let wikiId = [];
    try { wikiId = await searchWikipedia(query, { ...options, language: 'id' }); combined.push(...wikiId); }
    catch (error) { console.warn('[AutoSource] Wikipedia ID gagal:', error.message); }
    if (!wikiId.length) await add('Wikipedia EN', () => searchWikipedia(query, { ...options, language: 'en' }));
  }
  const seen = new Set();
  return combined.filter(item => {
    const key = canonicalUrl(item.url);
    if (!key || !candidateAllowed(key) || seen.has(key)) return false;
    seen.add(key);
    item.url = key;
    return true;
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
  const finalUrl = canonicalUrl(data?.url || validated.href) || validated.href;
  if (!candidateAllowed(finalUrl)) throw new Error('Jina Reader berakhir pada URL perantara/search, bukan artikel.');
  return {
    url: rawUrl,
    finalUrl,
    title: String(data?.title || '').trim(),
    text: text.slice(0, 16000),
    fetchedAt: new Date().toISOString()
  };
}
async function fetchCandidate(candidate, { sourceFetcher = defaultSourceFetcher, fetchImpl = fetch } = {}) {
  try {
    const [source] = await sourceFetcher.fetchSources([candidate.url]);
    if (!source || !candidateAllowed(source.finalUrl || source.url)) throw new Error('Sumber berakhir pada URL perantara/search.');
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

function minimumRelevantFraction(topic) {
  const count = tokens(topic).length;
  if (count <= 1) return 1;
  if (count === 2) return 0.5;
  if (count === 3) return 0.66;
  return 0.5;
}

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
    candidates.push(...results.slice(0, 10).map(result => ({ ...result, query })));
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

  const minimumRelevance = minimumRelevantFraction(cleanTopic);
  const fetched = [];
  for (const candidate of ranked.slice(0, MAX_FETCH_CANDIDATES)) {
    const source = await fetchCandidate(candidate, { sourceFetcher, fetchImpl });
    if (!source) continue;
    const combinedText = `${source.title || ''} ${String(source.text || '').slice(0, 6000)}`;
    const relevance = relevanceScore(cleanTopic, combinedText);
    const titleRelevance = relevanceScore(cleanTopic, source.title || '');
    const searchRelevance = Math.max(relevanceScore(cleanTopic, candidate.title), relevanceScore(cleanTopic, candidate.description));
    if (relevance < minimumRelevance && titleRelevance < minimumRelevance && searchRelevance < minimumRelevance) continue;
    const factCount = sourceFacts([source]).length;
    if (factCount < 3) continue;
    const score = fetchedScore(cleanTopic, source, candidate, factCount);
    fetched.push({ ...source, discovery: { provider: candidate.provider, query: candidate.query, score, relevance: Math.max(relevance, titleRelevance, searchRelevance), factCount } });
  }
  fetched.sort((a, b) => b.discovery.score - a.discovery.score);
  const selected = [];
  const usedHosts = new Set();
  const bestScore = fetched[0]?.discovery?.score || 0;
  for (const source of fetched) {
    if (selected.length && bestScore > 0 && source.discovery.score < bestScore * 0.45) continue;
    let host = '';
    try { host = new URL(source.finalUrl || source.url).hostname; } catch {}
    if (!host || LOW_VALUE_HOSTS.test(host)) continue;
    const hasAlternativeHost = fetched.some(other => {
      try {
        const otherHost = new URL(other.finalUrl || other.url).hostname;
        return otherHost !== host && !usedHosts.has(otherHost);
      } catch { return false; }
    });
    if (usedHosts.has(host) && hasAlternativeHost && selected.length < 2) continue;
    selected.push(source);
    usedHosts.add(host);
    if (selected.length >= MAX_SELECTED) break;
  }
  if (!selected.length) throw Object.assign(new Error('Sumber ditemukan, tetapi belum ada artikel yang cukup relevan, kaya fakta, dan dapat dibaca setelah pencarian diperluas.'), { status: 422, code: 'AUTO_SOURCE_FETCH_EMPTY' });

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
  discover, searchWeb, searchJina, searchBingNews, searchBingWeb, searchWikipedia, searchQueries,
  candidateAllowed, canonicalUrl, unwrapKnownRedirect, relevanceScore, candidateScore,
  fetchCandidate, fetchViaJinaReader, clearCache, minimumRelevantFraction,
  CACHE_TTL_MS, MAX_CANDIDATES, MAX_FETCH_CANDIDATES, MAX_SELECTED
};
