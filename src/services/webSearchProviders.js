const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

// Web Search ROUTER — mirrors the reference spec:
//   1) Tavily untuk pencarian awal (primary)
//   2) You.com untuk research/verifikasi (verify)
//   3) Gabungkan hasil  4) AI Chat menyusun jawaban  5) Tampilkan sumber
// Cost-aware: JANGAN selalu panggil dua-duanya. Router memutuskan kapan cukup
// satu provider (primary) dan kapan perlu keduanya (verifikasi/mendalam atau
// saat hasil primary kurang). Tidak dikunci ke 2 provider: You.com & Tavily
// jadi preset, "generic"/"auto" membaca payload REST/OpenAI-style umum, jadi
// provider lain jalan cukup isi Base URL + API key.
const initialized = new WeakSet();
const MIN_PRIMARY_RESULTS = 2;

// Sinyal query yang layak "eskalasi" ke verifikasi (panggil provider ke-2).
const VERIFY_SIGNAL = /(verifikasi|cek fakta|cek\s|benarkah|faktanya|fakta\b|hoaks?|klaim|konfirmasi|apakah benar|fact.?check|verify|research|riset|mendalam|detail|bandingkan|akurat|valid|pastikan|sumber terpercaya|beneran|betulkah)/i;

function encryptionKey(create = false) {
  const directory = path.dirname(config.databasePath);
  const file = path.join(directory, '.provider-encryption-key');
  if (!fs.existsSync(file) && create) {
    fs.mkdirSync(directory, { recursive: true });
    try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!fs.existsSync(file)) throw Object.assign(new Error('Kunci enkripsi provider tidak tersedia di backend.'), { status: 503 });
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw Object.assign(new Error('Kunci enkripsi provider tidak valid.'), { status: 503 });
  return key;
}

function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(true), iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return 'v2.' + [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
}

function decrypt(value) {
  if (!value) return '';
  const [iv, tag, data] = String(value).replace(/^v2\./, '').split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const FORMATS = new Set(['auto', 'youcom', 'youcom_classic', 'tavily', 'generic']);
function normalizeFormat(raw) {
  const value = String(raw || 'auto').toLowerCase().trim();
  return FORMATS.has(value) ? value : 'auto';
}

const ROLES = new Set(['primary', 'verify', 'auto']);
function normalizeRole(raw) {
  const value = String(raw || 'auto').toLowerCase().trim();
  return ROLES.has(value) ? value : 'auto';
}

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Base URL tidak valid.'), { status: 422 }); }
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('Base URL harus memakai http:// atau https://.'), { status: 422 });
  if (url.username || url.password || url.hash) throw Object.assign(new Error('Base URL tidak boleh berisi kredensial atau fragment.'), { status: 422 });
  // Strip a trailing /search so both "host" and "host/.../search" inputs work.
  url.pathname = url.pathname.replace(/\/+search\/?$/i, '').replace(/\/+$/, '');
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function detectFormat(baseUrl) {
  const host = (() => { try { return new URL(baseUrl).hostname.toLowerCase(); } catch { return ''; } })();
  if (/ydc-index\.io|you\.com/.test(host)) return 'youcom';
  if (/tavily\.com/.test(host)) return 'tavily';
  return 'generic';
}

// Default role by provider type, per the reference:
// Tavily = pencarian awal (primary), You.com = verifikasi (verify).
function defaultRoleFor(effectiveFormat) {
  if (effectiveFormat === 'tavily') return 'primary';
  if (effectiveFormat === 'youcom' || effectiveFormat === 'youcom_classic') return 'verify';
  return 'auto';
}

function providerId(baseUrl, format) {
  return `search-${crypto.createHash('sha1').update(`${format}:${baseUrl}`).digest('hex').slice(0, 12)}`;
}

function inferName(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/^api\./, '');
    const first = host.split('.')[0] || 'Search';
    return first.replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  } catch { return 'Search'; }
}

function join(baseUrl, endpoint) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${String(endpoint).replace(/^\/+/, '')}`;
}

// You.com v1 search endpoint (POST). Ensures the path carries a version segment.
function youcomUrl(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  return /\/v\d+$/.test(base) ? `${base}/search` : `${base}/v1/search`;
}

// Build the HTTP request for a given format. Returns { url, init }.
function buildSearchRequest(effectiveFormat, baseUrl, apiKey, query, limit) {
  const q = String(query || '').trim();
  if (effectiveFormat === 'youcom') {
    // Real You.com API (per docs): POST /v1/search, X-API-Key.
    // Body: query + count; extraction:highlights gives token-efficient snippets.
    return {
      url: youcomUrl(baseUrl),
      init: {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: q, count: Math.min(Math.max(limit, 1), 20), extraction: { extraction_mode: 'highlights' } })
      }
    };
  }
  if (effectiveFormat === 'youcom_classic') {
    // Older You.com Search API: GET /search?query=, X-API-Key.
    const url = new URL(join(baseUrl, 'search'));
    url.searchParams.set('query', q);
    return { url: url.toString(), init: { method: 'GET', headers: { 'X-API-Key': apiKey, Accept: 'application/json' } } };
  }
  if (effectiveFormat === 'tavily') {
    // Real Tavily API (per docs): POST /search, Authorization Bearer.
    return {
      url: join(baseUrl, 'search'),
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ api_key: apiKey, query: q, max_results: limit, search_depth: 'basic', include_answer: false })
      }
    };
  }
  // generic: OpenAI-style POST /search with a body most engines accept.
  return {
    url: join(baseUrl, 'search'),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-API-Key': apiKey, Accept: 'application/json' },
      body: JSON.stringify({ query: q, q, max_results: limit, count: limit })
    }
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

// Collect the raw result rows from any provider payload shape.
function collectRows(payload) {
  if (!payload || typeof payload !== 'object') return [];
  // You.com v1 POST /search: `results` is an OBJECT with web/news/knowledge arrays.
  const r = payload.results;
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    const grouped = [...(Array.isArray(r.web) ? r.web : []), ...(Array.isArray(r.news) ? r.news : []), ...(Array.isArray(r.knowledge) ? r.knowledge : [])];
    if (grouped.length) return grouped;
  }
  const candidates = [
    payload.hits, payload.results, payload.web?.results, payload.data,
    payload.organic, payload.organic_results, payload.items, payload.documents,
    payload.result?.results, payload.result?.hits, payload.answer?.results,
    Array.isArray(payload.web) ? payload.web : null, Array.isArray(payload.news) ? payload.news : null
  ];
  return candidates.find(Array.isArray) || [];
}

function extractSnippet(item) {
  const contents = item.contents && typeof item.contents === 'object' ? item.contents : null;
  const highlightsArr = Array.isArray(item.highlights) ? item.highlights
    : contents && Array.isArray(contents.highlights) ? contents.highlights : null;
  const snippetsArr = Array.isArray(item.snippets) ? item.snippets : null;
  const joined = arr => (arr || []).filter(v => typeof v === 'string' && v.trim()).join(' ');
  return firstString(
    item.snippet,
    item.description,
    joined(highlightsArr),
    joined(snippetsArr),
    item.content,
    contents && (contents.markdown || contents.text),
    item.text,
    item.summary
  );
}

// Flexibly pull {title, url, snippet} rows from any of the common shapes.
function parseSearchResults(payload, limit) {
  const list = collectRows(payload);
  const rows = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const url = firstString(item.url, item.link, item.href, item.source_url, item.document_url);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const snippet = extractSnippet(item);
    const title = firstString(item.title, item.name, item.heading, url);
    rows.push({ title, url, snippet });
    if (rows.length >= limit) break;
  }
  return rows;
}

function searchError(status) {
  const detail = status === 401 ? 'API Key ditolak' : status === 403 ? 'akses ditolak' : status === 429 ? 'kuota/rate limit tercapai' : 'request pencarian gagal';
  return Object.assign(new Error(`${detail} (HTTP ${status}).`), { status: status >= 400 && status <= 599 ? status : 502 });
}

async function runSearch({ baseUrl, apiKey, format, query, limit = 5 }, transport = fetch) {
  const effective = format === 'auto' ? detectFormat(baseUrl) : format;
  const { url, init } = buildSearchRequest(effective, baseUrl, apiKey, query, limit);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await transport(url, { ...init, signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    if (!response.ok) throw searchError(response.status);
    let payload;
    try { payload = JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('Provider pencarian mengembalikan respons non-JSON.'), { status: 502 }); }
    const results = parseSearchResults(payload, limit);
    return { results, format: effective };
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error(error.name === 'AbortError' ? 'Koneksi provider pencarian melewati batas waktu.' : 'Tidak dapat menghubungi endpoint pencarian.'), { status: 502 });
  } finally { clearTimeout(timer); }
}

function ensureColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function ensureSchema(db) {
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_search_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'auto',
      role TEXT NOT NULL DEFAULT 'auto',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS web_search_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      selected_provider_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO web_search_state(id) VALUES(1);
  `);
  // Migrate older deployments that predate the router (no role/enabled columns).
  ensureColumn(db, 'web_search_providers', 'role', "TEXT NOT NULL DEFAULT 'auto'");
  ensureColumn(db, 'web_search_providers', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  initialized.add(db);
}

function stateRow(db) { ensureSchema(db); return db.prepare('SELECT * FROM web_search_state WHERE id=1').get(); }

function providers(db) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM web_search_providers ORDER BY created_at,id').all().map(row => ({
    id: row.id, name: row.name, baseUrl: row.base_url, format: row.format, role: row.role,
    enabled: Boolean(row.enabled), hasApiKey: Boolean(row.api_key_encrypted), updatedAt: row.updated_at
  }));
}

function publicState(db) {
  const current = stateRow(db);
  const all = providers(db);
  const selected = all.find(item => item.id === current.selected_provider_id) || null;
  const activeCount = all.filter(item => item.enabled).length;
  return { providers: all, selectedProviderId: selected?.id || null, enabled: Boolean(current.enabled), activeCount };
}

function activeProviderRows(db, force = false) {
  const current = stateRow(db);
  if (!force && !current.enabled) return [];
  const enabled = db.prepare('SELECT * FROM web_search_providers WHERE enabled=1 ORDER BY created_at,id').all();
  if (enabled.length) return enabled;
  // Master toggle is on (or search was explicitly forced) but no provider is
  // individually enabled — fall back to every saved provider so search still
  // works instead of silently returning nothing.
  return db.prepare('SELECT * FROM web_search_providers ORDER BY created_at,id').all();
}

function providerRow(db, id) {
  return db.prepare('SELECT * FROM web_search_providers WHERE id=?').get(id) || null;
}

function normalizeUrlKey(url) {
  try { const u = new URL(url); return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`.toLowerCase(); }
  catch { return String(url).toLowerCase().replace(/\/+$/, ''); }
}

// Run a set of provider rows, merge + dedupe by URL, tag each row with source.
async function runProviders(rows, query, transport, limit) {
  const settled = await Promise.allSettled(rows.map(row =>
    runSearch({ baseUrl: row.base_url, apiKey: decrypt(row.api_key_encrypted), format: row.format, query, limit }, transport)
      .then(result => ({ name: row.name, results: result.results }))
  ));
  const merged = [];
  const seen = new Set();
  const used = [];
  const errors = [];
  // Interleave results from each provider so both voices show up before the cap.
  const perProvider = [];
  settled.forEach((entry, index) => {
    if (entry.status === 'fulfilled') { used.push(entry.value.name); perProvider.push({ name: entry.value.name, rows: entry.value.results }); }
    else errors.push({ name: rows[index].name, message: entry.reason?.message || 'gagal' });
  });
  let added = true;
  for (let i = 0; added && merged.length < limit; i += 1) {
    added = false;
    for (const provider of perProvider) {
      const row = provider.rows[i];
      if (!row) continue;
      added = true;
      const key = normalizeUrlKey(row.url);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...row, source: provider.name });
      if (merged.length >= limit) break;
    }
  }
  return { results: merged, used: [...new Set(used)], errors };
}

// Chat messages can be huge (thousands of chars: briefs, "WAJIB:" instructions).
// Search APIs reject long queries (YDC returns HTTP 422, Tavily silently
// downgrades). Distill the query to a compact, self-contained search string:
// keep the leading ask, strip instruction-list boilerplate, drop citations.
const MAX_QUERY_CHARS = 280;

// Indonesian chat boilerplate that pollutes search queries. Phrases like
// "yang benar-benar aktual, penting, dan memiliki informasi baru" make
// Tavily return dictionary pages ("arti berita aktual") instead of news.
const QUERY_NOISE = [
  // Full template tail: "yang benar-benar aktual, penting, dan memiliki informasi baru"
  /yang benar-benar \w+([,;:]\s*penting)?([,;]?\s*dan\s+)?(memiliki\s+informasi\s+(baru|terbaru))?/gi,
  /yang (aktual|terbaru|terkini|faktual|valid)([,]?\s*penting)?([,]?\s*dan\s+)?(memiliki\s+informasi\s+(baru|terbaru))?/gi,
  /memiliki informasi (baru|terbaru)/gi,
  /(penting|baru|terbaru|terkini),? dan /gi,
  /^(tolong|coba|silakan|silahkan|mohon|bisakah|bisa) (cari|carikan|cukup|tolong)?\b/i,
  /^(apa|apakah) (kabar|berita) (tentang|soal|perihal) /i,
  /\bberi?(tahu|kan) (aku|saya|ku)\b/gi,
  /\bHARI INI\b/gi
];

function distillQuery(raw) {
  const original = String(raw || '');
  let text = original.replace(/\s+/g, ' ').trim();
  if (!text) return text;
  // Always cut at instruction-list boilerplate ("WAJIB:", "Instruksi:", or a
  // leading list item) — it is never part of the actual search intent.
  const boundaries = [text.search(/ WAJIB[:, ]/i), text.search(/\s[-•]\s/), text.search(/Instruksi|instruction/i)]
    .filter(index => index > 20);
  const boundary = boundaries.length ? Math.min(...boundaries) : -1;
  if (boundary > 0) text = text.slice(0, boundary);
  // Normalize quotes around the topic: “ X ” / " X " -> X
  text = text.replace(/[“”"'']+ */g, ' ').replace(/ *[“”"'']+/g, ' ').replace(/\s+/g, ' ').trim();
  // Strip conversational noise so the search engine sees the TOPIC, not the
  // requirements about what the results should be like.
  for (const pattern of QUERY_NOISE) text = text.replace(pattern, ' ');
  // Orphaned fragments left behind by noise removal
  text = text.replace(/\s*,?\s*(dan|atau|serta|penting)\s*,?\s*$/i, '');
  text = text.replace(/^[\s,;:.\-–—]+/, '').replace(/[\s,;:.\-–—?!]+$/, '').replace(/\s+/g, ' ').trim();
  // Keep just the topic when a "tentang/soal/about X" tail remains, but
  // preserve the news intent: "Cari berita terbaru tentang X" -> "X berita terbaru"
  const tentang = text.match(/(?:tentang|soal|perihal|mengenai|about|for)\s+(.+)$/i);
  if (tentang && tentang[1].trim().length >= 3) {
    const topic = tentang[1].trim();
    const wantsNews = /berita|news|kabar|informasi|terbaru|terkini|aktual/i.test(text);
    text = wantsNews && !/berita|news|terbaru|terkini/i.test(topic) ? `${topic} berita terbaru` : topic;
  }
  // Leading verb "cari/carikan" with the object directly ("cari X")
  text = text.replace(/^cari(lah|kan)?\s+/i, '');
  return text.slice(0, MAX_QUERY_CHARS).replace(/[\s,;:.?!]+$/, '').trim();
}

// The ROUTER with automatic failover. Tries providers in priority order and
// returns as soon as one yields usable results. If a provider errors or returns
// nothing, it automatically falls back to the next provider. Only throws when
// EVERY provider failed — and then reports each provider's specific error.
// `force` (search button / AI-invoked) searches even if the master toggle is
// off and ignores per-provider disable so an explicit action never no-ops.
async function routeSearch(db, query, transport = fetch, limit = 5, force = false) {
  const rows = activeProviderRows(db, force);
  if (!rows.length) return { results: [], enabled: false, providers: [], plan: 'off' };

  // Priority order: primary hint first, then verify, then the rest.
  const current = stateRow(db);
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b));
  function rank(row) {
    if (row.role === 'primary') return 0;
    if (row.id === current.selected_provider_id) return 1;
    if (row.role === 'verify') return 2;
    return 3;
  }

  const q = distillQuery(query);
  if (!q) return { results: [], enabled: true, providers: [], plan: 'empty' };
  const wantVerify = VERIFY_SIGNAL.test(q) || q.length > 140;

  // Verify/deep queries: try to combine the top two providers for richer,
  // cross-checked results. If that combo yields nothing, fall through to
  // sequential single-provider failover below.
  const allErrors = [];
  if (wantVerify && ordered.length >= 2) {
    const combo = await runProviders(ordered.slice(0, 2), q, transport, limit);
    if (combo.results.length) return { results: combo.results, enabled: true, providers: combo.used, plan: 'both' };
    allErrors.push(...combo.errors);
  }

  // Sequential failover: walk every provider in priority order until one
  // returns results. This is the behaviour the user asked for — if one Web
  // Search is down/disabled/erroring, automatically use the next one.
  for (const row of ordered) {
    const single = await runProviders([row], q, transport, limit);
    if (single.results.length) return { results: single.results, enabled: true, providers: single.used, plan: 'failover' };
    allErrors.push(...single.errors);
  }

  // Everyone failed — surface a combined, provider-named error.
  if (allErrors.length) {
    const seen = new Set();
    const detail = allErrors.filter(e => { const k = `${e.name}:${e.message}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(e => `${e.name}: ${e.message}`).join(' | ');
    throw Object.assign(new Error(`Semua provider Web Search gagal — ${detail}`), { status: 502 });
  }
  return { results: [], enabled: true, providers: [], plan: 'empty' };
}

// Backward-compatible entry used by the AI Chat.
async function searchForChat(db, query, transport = fetch, limit = 5, force = false) {
  return routeSearch(db, query, transport, limit, force);
}

function saveProvider(db, { baseUrl, apiKey, format, role }, transport = fetch) {
  return (async () => {
    ensureSchema(db);
    const normalizedBase = normalizeBaseUrl(baseUrl);
    const key = String(apiKey || '').trim();
    if (!key) throw Object.assign(new Error('API Key wajib diisi.'), { status: 422 });
    const fmt = normalizeFormat(format);
    // Validate with a REAL search before saving; reject if it returns nothing.
    const probe = await runSearch({ baseUrl: normalizedBase, apiKey: key, format: fmt, query: 'berita terbaru hari ini', limit: 3 }, transport);
    if (!probe.results.length) throw Object.assign(new Error('Provider terhubung tetapi tidak mengembalikan hasil pencarian yang dikenali. Periksa Base URL/format.'), { status: 422 });
    const id = providerId(normalizedBase, fmt);
    const name = inferName(normalizedBase);
    const existing = providerRow(db, id);
    const resolvedRole = role ? normalizeRole(role) : (existing?.role || defaultRoleFor(probe.format));
    db.prepare(`INSERT INTO web_search_providers(id,name,base_url,api_key_encrypted,format,role,enabled,updated_at)
      VALUES(?,?,?,?,?,?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,api_key_encrypted=excluded.api_key_encrypted,format=excluded.format,role=excluded.role,enabled=1,updated_at=CURRENT_TIMESTAMP`)
      .run(id, name, normalizedBase, encrypt(key), fmt, resolvedRole);
    // First provider also becomes the selected primary hint + turns the feature on.
    const current = stateRow(db);
    if (!current.selected_provider_id) db.prepare('UPDATE web_search_state SET selected_provider_id=? WHERE id=1').run(id);
    db.prepare('UPDATE web_search_state SET enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=1').run();
    return { ...publicState(db), saved: { id, name, format: probe.format, role: resolvedRole, sampleCount: probe.results.length } };
  })();
}

function removeProvider(db, id) {
  ensureSchema(db);
  if (!providerRow(db, id)) throw Object.assign(new Error('Provider pencarian tidak ditemukan.'), { status: 404 });
  db.transaction(() => {
    db.prepare('DELETE FROM web_search_providers WHERE id=?').run(id);
    db.prepare('UPDATE web_search_state SET selected_provider_id=CASE WHEN selected_provider_id=? THEN NULL ELSE selected_provider_id END, updated_at=CURRENT_TIMESTAMP WHERE id=1').run(id);
  })();
  // If no providers remain, switch the master toggle off.
  if (!providers(db).length) db.prepare('UPDATE web_search_state SET enabled=0 WHERE id=1').run();
  return publicState(db);
}

function setSelected(db, id) {
  ensureSchema(db);
  if (!providerRow(db, id)) throw Object.assign(new Error('Provider pencarian tidak ditemukan.'), { status: 404 });
  db.prepare('UPDATE web_search_state SET selected_provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(id);
  return publicState(db);
}

function setRole(db, id, role) {
  ensureSchema(db);
  if (!providerRow(db, id)) throw Object.assign(new Error('Provider pencarian tidak ditemukan.'), { status: 404 });
  db.prepare('UPDATE web_search_providers SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(normalizeRole(role), id);
  return publicState(db);
}

function setProviderEnabled(db, id, enabled) {
  ensureSchema(db);
  if (!providerRow(db, id)) throw Object.assign(new Error('Provider pencarian tidak ditemukan.'), { status: 404 });
  if (typeof enabled !== 'boolean') throw Object.assign(new Error('Nilai enabled harus boolean.'), { status: 422 });
  db.prepare('UPDATE web_search_providers SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(Number(enabled), id);
  return publicState(db);
}

function setEnabled(db, enabled) {
  ensureSchema(db);
  if (typeof enabled !== 'boolean') throw Object.assign(new Error('Nilai enabled harus boolean.'), { status: 422 });
  if (enabled && !providers(db).some(p => p.enabled)) throw Object.assign(new Error('Simpan & aktifkan minimal satu provider pencarian dulu.'), { status: 422 });
  db.prepare('UPDATE web_search_state SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(Number(enabled));
  return publicState(db);
}

function install({ app, db, transport = fetch }) {
  ensureSchema(db);

  app.get('/api/web-search/providers', (req, res) => res.json(publicState(db)));

  app.post('/api/web-search/providers', async (req, res, next) => {
    try { res.status(201).json(await saveProvider(db, { baseUrl: req.body?.baseUrl, apiKey: req.body?.apiKey, format: req.body?.format, role: req.body?.role }, transport)); }
    catch (error) { next(error); }
  });

  // Test a provider WITHOUT saving it — proves the AI-search round trip works
  // (real search + parsed sources) before the user commits the credentials.
  app.post('/api/web-search/test', async (req, res, next) => {
    try {
      const base = normalizeBaseUrl(req.body?.baseUrl);
      const key = String(req.body?.apiKey || '').trim();
      if (!key) throw Object.assign(new Error('API Key wajib diisi.'), { status: 422 });
      const fmt = normalizeFormat(req.body?.format);
      const query = String(req.body?.query || 'berita terbaru hari ini').trim();
      const { results, format } = await runSearch({ baseUrl: base, apiKey: key, format: fmt, query, limit: 3 }, transport);
      res.json({ ok: results.length > 0, format, count: results.length, results: results.map(r => ({ title: r.title, url: r.url })) });
    } catch (error) { next(error); }
  });

  app.put('/api/web-search/selected', (req, res, next) => {
    try { res.json(setSelected(db, req.body?.providerId)); } catch (error) { next(error); }
  });

  app.put('/api/web-search/enabled', (req, res, next) => {
    try { res.json(setEnabled(db, req.body?.enabled)); } catch (error) { next(error); }
  });

  app.put('/api/web-search/providers/:id/role', (req, res, next) => {
    try { res.json(setRole(db, req.params.id, req.body?.role)); } catch (error) { next(error); }
  });

  app.put('/api/web-search/providers/:id/enabled', (req, res, next) => {
    try { res.json(setProviderEnabled(db, req.params.id, req.body?.enabled)); } catch (error) { next(error); }
  });

  app.delete('/api/web-search/providers/:id', (req, res, next) => {
    try { res.json(removeProvider(db, req.params.id)); } catch (error) { next(error); }
  });

  app.use('/api/web-search', (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number(error?.status) || (error?.name === 'AbortError' ? 504 : 500);
    res.status(status).json({ error: error?.message || 'Provider pencarian gagal.' });
  });
}

module.exports = {
  install,
  ensureSchema,
  publicState,
  saveProvider,
  removeProvider,
  setSelected,
  setRole,
  setProviderEnabled,
  setEnabled,
  searchForChat,
  routeSearch,
  runSearch,
  parseSearchResults,
  detectFormat,
  defaultRoleFor,
  normalizeBaseUrl,
  buildSearchRequest,
  youcomUrl,
  FORMATS
};
