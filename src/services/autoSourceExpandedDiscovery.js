const defaultSourceFetcher = require('./sourceFetcher');
const baseDiscovery = require('./autoSourceDiscovery');
const fastDiscovery = require('./autoSourceFastDiscovery');
const dynamicScope = require('./autoSourceDynamicScope');
const { sourceFacts } = require('./manualSourceFallback');

// TANPA URL / AUTO SOURCE ONLY.
// This module is loaded only after autoSourcePatch has already excluded Pakai URL.
const CACHE_TTL_MS = 10 * 60 * 1000;
const QUERY_CONCURRENCY = 3;
const FETCH_CONCURRENCY = 6;
const MAX_CANDIDATES = 32;
const MAX_FETCH_CANDIDATES = 20;
const MAX_SELECTED = 4;
const MIN_FACTS_PER_SOURCE = 1;
const MIN_TOTAL_FACTS = 4;
const MIN_SNIPPET_DESCRIPTION_WORDS = 8;
const SEARCH_TIMEOUT_MS = 10_000;
const cache = new Map();

const INTENT_STOPWORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','dalam','ini','itu','baru','terbaru','cara','aplikasi','fitur',
  'potensi','manfaat','dampak','pengaruh','terhadap','peran','kemampuan','fungsi','kegunaan','penggunaan','penerapan','contoh',
  'akan','bisa','dapat','menjadi','membantu','membuat','teknologi','edukasi','fakta','singkat','update','berita',
  'the','and','or','from','for','with','about','new','latest','how','can','could','benefit','benefits','impact','role','use','uses','using'
]);
const BILINGUAL_ALIASES = new Map([
  ['ai', ['ai', 'artificial intelligence', 'machine learning']],
  ['iklim', ['iklim', 'climate']],
  ['cuaca', ['cuaca', 'weather']],
  ['keamanan', ['keamanan', 'security']],
  ['siber', ['siber', 'cyber']],
  ['privasi', ['privasi', 'privacy']],
  ['energi', ['energi', 'energy']],
  ['kesehatan', ['kesehatan', 'health']],
  ['pendidikan', ['pendidikan', 'education']],
  ['belajar', ['belajar', 'learning']],
  ['pemrograman', ['pemrograman', 'programming']],
  ['kode', ['kode', 'code']],
  ['robot', ['robot', 'robotics']],
  ['bisnis', ['bisnis', 'business']],
  ['iklan', ['iklan', 'advertising', 'ads']],
  ['video', ['video']],
  ['gambar', ['gambar', 'image', 'images']],
  ['suara', ['suara', 'voice', 'audio']],
  ['model', ['model']],
  ['agen', ['agen', 'agent']],
  ['coding', ['coding', 'code']]
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalized(value) {
  return String(value || '').toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function anchorGroups(topic) {
  const raw = normalized(topic).split(' ').filter(Boolean);
  const groups = [];
  const seen = new Set();
  for (const token of raw) {
    if ((token.length <= 2 && token !== 'ai') || INTENT_STOPWORDS.has(token)) continue;
    const aliases = BILINGUAL_ALIASES.get(token) || [token];
    const key = aliases.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(aliases);
  }
  return groups;
}

function multilingualRelevance(topic, value) {
  const groups = anchorGroups(topic);
  if (!groups.length) return 0;
  const haystack = ` ${normalized(value)} `;
  let matched = 0;
  for (const aliases of groups) {
    if (aliases.some(alias => haystack.includes(` ${normalized(alias)} `))) matched += 1;
  }
  return matched / groups.length;
}

function multilingualMinimum(topic) {
  const count = anchorGroups(topic).length;
  if (count <= 1) return 1;
  if (count === 2) return 1;
  if (count === 3) return 0.66;
  return 0.5;
}

function relevanceTopics(topic, plan = null) {
  const values = [
    topic,
    plan?.canonicalTopic,
    ...(Array.isArray(plan?.searchQueries) ? plan.searchQueries : []),
    [
      ...(Array.isArray(plan?.subjects) ? plan.subjects : []),
      ...(Array.isArray(plan?.eventTerms) ? plan.eventTerms : []),
      ...(Array.isArray(plan?.contextTerms) ? plan.contextTerms : [])
    ].join(' ')
  ];
  const seen = new Set();
  return values.map(value => String(value || '').trim().replace(/\s+/g, ' ')).filter(value => {
    const key = normalized(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function plannedRelevance(topic, value, plan = null) {
  return Math.max(0, ...relevanceTopics(topic, plan).map(variant => multilingualRelevance(variant, value)));
}

function planHasScope(plan = null) {
  return ['subjects', 'eventTerms', 'actionTerms', 'contextTerms']
    .some(key => Array.isArray(plan?.[key]) && plan[key].length > 0);
}

function englishAnchorQuery(topic) {
  const groups = anchorGroups(topic);
  return groups.map(aliases => {
    const original = aliases[0];
    if (original === 'ai') return 'AI';
    return aliases.find(alias => /^[a-z][a-z\s-]*$/i.test(alias) && alias !== original) || original;
  }).join(' ').trim();
}

function subjectlessEventQueries(plan = null) {
  if (!dynamicScope.eventLockRequired(plan || {})) return [];
  const actions = [...new Set((plan.actionTerms || []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 3);
  const contexts = [...new Set((plan.contextTerms || []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 3);
  const subjects = plan.subjects || [];
  const combinations = [];

  for (const action of actions) {
    for (const context of contexts) {
      if (normalized(action) === normalized(context)) continue;
      combinations.push(`${action} ${context} latest`);
    }
  }
  for (const term of plan.eventTerms || []) {
    const value = String(term || '').trim();
    if (value.split(/\s+/).length < 2) continue;
    if (subjects.some(subject => dynamicScope.phrasePresent(subject, value))) continue;
    combinations.push(`${value} latest`);
  }
  return [...new Set(combinations.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 3);
}

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

function expandedQueries(topic, category = '', plan = null) {
  const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ');
  const english = englishAnchorQuery(cleanTopic);
  const base = baseDiscovery.searchQueries(cleanTopic, category);
  const planQueries = Array.isArray(plan?.searchQueries) ? plan.searchQueries : [];
  const eventRescueQueries = subjectlessEventQueries(plan);
  const subjects = Array.isArray(plan?.subjects) ? plan.subjects.join(' ') : '';
  const contextQueries = [...new Set([
    ...(Array.isArray(plan?.contextTerms) ? plan.contextTerms : []),
    ...(Array.isArray(plan?.eventTerms) ? plan.eventTerms : [])
  ].map(value => String(value || '').trim()).filter(Boolean))]
    .slice(0, 3)
    .map(context => `${subjects} ${context}`.trim());
  const values = [
    cleanTopic,
    ...planQueries.slice(0, 3),
    ...eventRescueQueries,
    ...contextQueries,
    ...planQueries.slice(3),
    ...base,
    english && normalized(english) !== normalized(cleanTopic) ? `${english} latest` : '',
    `${cleanTopic} terbaru`,
    `${cleanTopic} latest`,
    `${cleanTopic} official`,
    `${cleanTopic} research report`
  ];
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 8);
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

function cleanSnippet(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippetEvidenceText(candidate = {}) {
  const description = cleanSnippet(candidate.description);
  if (description.split(/\s+/).filter(Boolean).length < MIN_SNIPPET_DESCRIPTION_WORDS) return '';
  // The title helps scope/ranking, but it is not treated as factual evidence:
  // headlines may be questions or clickbait. Claims can quote only the snippet.
  return description;
}

function evidenceFactCount(sources = []) {
  return sourceFacts(sources).length;
}

function snippetEvidenceSource(candidate = {}, topic = '', plan = null, nowMs = Date.now()) {
  const url = baseDiscovery.canonicalUrl(candidate.url);
  const title = cleanSnippet(candidate.title);
  const text = snippetEvidenceText(candidate);
  if (!url || !title || !text) return null;

  const source = {
    url,
    finalUrl: url,
    title,
    text,
    publishedAt: candidate.publishedAt || null,
    fetchedAt: new Date(nowMs).toISOString(),
    autoSourceFallback: { mode: 'search-result-evidence' }
  };
  if (!fetchedContentRelevant(topic, source, plan)) return null;
  if (planHasScope(plan) && !dynamicScope.sourceInScope(topic, source, plan)) return null;
  if (planHasScope(plan)) {
    const headlineLead = `${title} ${text}`;
    const leadHasSubject = !(plan.subjects || []).length || dynamicScope.subjectHits(plan, headlineLead).length > 0;
    const hasDistinguishingTerms = (plan.contextTerms || []).length || (plan.eventTerms || []).length;
    const leadHasContext = !hasDistinguishingTerms
      || dynamicScope.contextHits(plan, headlineLead).length > 0
      || dynamicScope.eventHits(plan, headlineLead).length > 0;
    if (!leadHasSubject || !leadHasContext) return null;
  }

  const factCount = evidenceFactCount([source]);
  if (!factCount) return null;
  const publisher = publisherKey(url);
  if (!publisher) return null;

  return {
    ...source,
    discovery: {
      provider: candidate.provider,
      query: candidate.query,
      score: Number(candidate.searchScore || candidateScore(topic, candidate, nowMs, plan)),
      relevance: plannedRelevance(topic, `${title} ${text}`, plan),
      factCount,
      publishedAt: candidate.publishedAt || null,
      publisher,
      evidenceMode: 'search-snippet'
    }
  };
}

function selectSnippetSources(ranked = [], topic = '', plan = null, nowMs = Date.now(), limit = MAX_SELECTED) {
  const eligible = ranked.map(candidate => snippetEvidenceSource(candidate, topic, plan, nowMs)).filter(Boolean);
  const selected = [];
  const publishers = new Set();

  // Prefer independent publishers first. Only reuse a publisher when the search
  // returned too little evidence elsewhere and four distinct facts still need support.
  for (const source of eligible) {
    const publisher = source.discovery.publisher;
    if (publishers.has(publisher)) continue;
    selected.push(source);
    publishers.add(publisher);
    if (selected.length >= limit || (selected.length >= 2 && evidenceFactCount(selected) >= MIN_TOTAL_FACTS)) break;
  }
  if (evidenceFactCount(selected) < MIN_TOTAL_FACTS) {
    for (const source of eligible) {
      if (selected.some(current => current.finalUrl === source.finalUrl)) continue;
      selected.push(source);
      if (selected.length >= limit || evidenceFactCount(selected) >= MIN_TOTAL_FACTS) break;
    }
  }

  return evidenceFactCount(selected) >= MIN_TOTAL_FACTS ? selected : [];
}

function candidateScore(topic, candidate, nowMs, plan = null) {
  const titleRelevance = plannedRelevance(topic, candidate?.title || '', plan);
  const descriptionRelevance = plannedRelevance(topic, candidate?.description || '', plan);
  return baseDiscovery.candidateScore(topic, candidate)
    + titleRelevance * 6
    + descriptionRelevance * 2.5
    + freshnessScore(candidate?.publishedAt, nowMs);
}

function fetchedScore(topic, source, candidate, factCount, nowMs, plan = null) {
  const titleRelevance = plannedRelevance(topic, source?.title || '', plan);
  const bodyRelevance = plannedRelevance(topic, `${source?.title || ''} ${String(source?.text || '').slice(0, 9000)}`, plan);
  return candidateScore(topic, candidate, nowMs, plan)
    + titleRelevance * 6
    + bodyRelevance * 10
    + Math.min(16, factCount) * 0.3;
}

function fetchedContentRelevant(topic, source, plan = null) {
  if (planHasScope(plan) && dynamicScope.sourceInScope(topic, source, plan)) return true;
  const variants = relevanceTopics(topic, plan);
  const combined = `${source?.title || ''} ${String(source?.text || '').slice(0, 9000)}`;
  // Search-result snippets may be stale or misleading. The fetched article itself
  // must satisfy at least one complete interpreted query before selection. The
  // stricter dynamic scope runs again after discovery against the original topic.
  return variants.some(variant => {
    const minimum = multilingualMinimum(variant);
    return Math.max(
      multilingualRelevance(variant, source?.title || ''),
      multilingualRelevance(variant, combined)
    ) >= minimum;
  });
}

async function discover({
  topic,
  category = '',
  searchImpl = expandedSearchWeb,
  sourceFetcher = defaultSourceFetcher,
  fetchImpl = fetch,
  now = Date.now,
  topicPlan = null
} = {}) {
  const cleanTopic = String(topic || '').trim().replace(/\s+/g, ' ');
  if (!cleanTopic) throw Object.assign(new Error('Topik wajib diisi untuk pencarian sumber otomatis.'), { status: 400 });

  const nowMs = now();
  const planKey = relevanceTopics(cleanTopic, topicPlan).map(normalized).join('|');
  const cacheKey = `${cleanTopic.toLocaleLowerCase('id-ID')}|${String(category || '').toLocaleLowerCase('id-ID')}|${planKey}`;
  const cached = cache.get(cacheKey);
  if (cached && nowMs - cached.savedAt < CACHE_TTL_MS) return clone(cached.bundle);

  const queries = expandedQueries(cleanTopic, category, topicPlan);
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
    const value = { ...candidate, url, searchScore: candidateScore(cleanTopic, candidate, nowMs, topicPlan) };
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
    if (!source || !fetchedContentRelevant(cleanTopic, source, topicPlan)) return null;
    const facts = sourceFacts([source]);
    if (facts.length < MIN_FACTS_PER_SOURCE) return null;
    const titleRelevance = plannedRelevance(cleanTopic, source.title || '', topicPlan);
    const bodyRelevance = plannedRelevance(cleanTopic, `${source.title || ''} ${String(source.text || '').slice(0, 9000)}`, topicPlan);
    return {
      ...source,
      publishedAt: source.publishedAt || candidate.publishedAt || null,
      discovery: {
        provider: candidate.provider,
        query: candidate.query,
        score: fetchedScore(cleanTopic, source, candidate, facts.length, nowMs, topicPlan),
        relevance: Math.max(titleRelevance, bodyRelevance),
        factCount: facts.length,
        publishedAt: source.publishedAt || candidate.publishedAt || null,
        publisher: publisherKey(source.finalUrl || source.url)
      }
    };
  });

  const fetched = fetchedRows.filter(Boolean).sort((a, b) => b.discovery.score - a.discovery.score);
  let selected = [];
  let publishers = new Set();
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
  if (evidenceFactCount(selected) < MIN_TOTAL_FACTS) {
    for (const source of fetched) {
      if (selected.includes(source)) continue;
      selected.push(source);
      const publisher = source.discovery?.publisher || publisherKey(source.finalUrl || source.url);
      if (publisher) publishers.add(publisher);
      if (selected.length >= MAX_SELECTED || evidenceFactCount(selected) >= MIN_TOTAL_FACTS) break;
    }
  }

  // Some publishers block both the direct extractor and Jina Reader, or expose
  // only a very short body. In Tanpa URL only, use the title/description returned
  // by the search provider as conservative evidence instead of rejecting a valid
  // free-form topic. The same runtime topic scope is applied before admission.
  if (evidenceFactCount(selected) < MIN_TOTAL_FACTS) {
    const snippets = selectSnippetSources(ranked, cleanTopic, topicPlan, nowMs);
    if (snippets.length) {
      selected = snippets;
      publishers = new Set(snippets.map(source => source.discovery.publisher));
      console.warn(`[AutoSource] artikel penuh tidak cukup terbaca; memakai ${snippets.length} cuplikan hasil pencarian yang lolos konteks.`);
    }
  }

  if (!selected.length || evidenceFactCount(selected) < MIN_TOTAL_FACTS) {
    throw Object.assign(new Error('Sumber ditemukan, tetapi belum ada artikel yang cukup relevan, kaya fakta, dapat dibaca, dan layak dipakai.'), { status: 422, code: 'AUTO_SOURCE_FETCH_EMPTY' });
  }

  const bundle = {
    topic: cleanTopic,
    searchedAt: new Date(nowMs).toISOString(),
    queries,
    providers: [...new Set(selected.map(source => source.discovery?.provider).filter(Boolean))],
    publishers: [...publishers],
    evidenceMode: selected.every(source => source.discovery?.evidenceMode === 'search-snippet')
      ? 'search-snippet-fallback'
      : 'full-article',
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
  anchorGroups,
  multilingualRelevance,
  multilingualMinimum,
  relevanceTopics,
  plannedRelevance,
  englishAnchorQuery,
  subjectlessEventQueries,
  fetchedContentRelevant,
  snippetEvidenceText,
  snippetEvidenceSource,
  selectSnippetSources,
  evidenceFactCount,
  clearCache,
  CACHE_TTL_MS,
  QUERY_CONCURRENCY,
  FETCH_CONCURRENCY,
  MAX_CANDIDATES,
  MAX_FETCH_CANDIDATES,
  MAX_SELECTED,
  MIN_FACTS_PER_SOURCE,
  MIN_TOTAL_FACTS,
  MIN_SNIPPET_DESCRIPTION_WORDS
};
