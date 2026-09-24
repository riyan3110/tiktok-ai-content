const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

// Web Search router — mirrors the dynamic AI provider pattern: a base URL + API
// key is saved per provider, validated with a REAL search call before it is
// stored, and any provider can be added (not hard-locked to two). Two presets
// (You.com and Tavily) ship as known formats; "generic" flexibly parses common
// OpenAI-style / REST search payloads so other providers work by just filling
// Base URL + API key. Flow (per reference diagram):
//   Kamu -> AI Chat -> Web Search API -> cari di web -> ambil hasil + sumber
//        -> AI merangkum -> jawaban + citation/link sumber
const initialized = new WeakSet();

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

const FORMATS = new Set(['auto', 'youcom', 'tavily', 'generic']);
function normalizeFormat(raw) {
  const value = String(raw || 'auto').toLowerCase().trim();
  return FORMATS.has(value) ? value : 'auto';
}

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Base URL tidak valid.'), { status: 422 }); }
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('Base URL harus memakai http:// atau https://.'), { status: 422 });
  if (url.username || url.password || url.hash) throw Object.assign(new Error('Base URL tidak boleh berisi kredensial atau fragment.'), { status: 422 });
  // Strip a trailing /search so both "host" and "host/search" inputs work.
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

// Build the HTTP request for a given format. Returns { url, init }.
function buildSearchRequest(effectiveFormat, baseUrl, apiKey, query, limit) {
  const q = String(query || '').trim();
  if (effectiveFormat === 'youcom') {
    const url = new URL(join(baseUrl, 'search'));
    url.searchParams.set('query', q);
    return { url: url.toString(), init: { method: 'GET', headers: { 'X-API-Key': apiKey, Accept: 'application/json' } } };
  }
  if (effectiveFormat === 'tavily') {
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

// Flexibly pull {title, url, snippet} rows from any of the common shapes.
function parseSearchResults(payload, limit) {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.hits, payload.results, payload.web?.results, payload.data,
    payload.organic, payload.organic_results, payload.items, payload.documents,
    payload.result?.results, payload.result?.hits
  ];
  const list = candidates.find(Array.isArray) || [];
  const rows = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const url = firstString(item.url, item.link, item.href, item.source_url, item.document_url);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const snippetArray = Array.isArray(item.snippets) ? item.snippets.filter(v => typeof v === 'string').join(' ') : '';
    const snippet = firstString(item.snippet, item.description, item.content, item.text, snippetArray, item.summary);
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

function ensureSchema(db) {
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_search_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'auto',
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
  initialized.add(db);
}

function stateRow(db) { ensureSchema(db); return db.prepare('SELECT * FROM web_search_state WHERE id=1').get(); }

function providers(db) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM web_search_providers ORDER BY created_at,id').all().map(row => ({
    id: row.id, name: row.name, baseUrl: row.base_url, format: row.format, hasApiKey: Boolean(row.api_key_encrypted), updatedAt: row.updated_at
  }));
}

function publicState(db) {
  const current = stateRow(db);
  const all = providers(db);
  const selected = all.find(item => item.id === current.selected_provider_id) || null;
  return { providers: all, selectedProviderId: selected?.id || null, enabled: Boolean(current.enabled) };
}

function selectedProviderRow(db) {
  const current = stateRow(db);
  if (!current.selected_provider_id) return null;
  return db.prepare('SELECT * FROM web_search_providers WHERE id=?').get(current.selected_provider_id) || null;
}

// Public search entry used by the AI Chat: returns [] when disabled/unconfigured
// so callers can degrade gracefully instead of erroring the whole chat.
async function searchForChat(db, query, transport = fetch, limit = 5) {
  const current = stateRow(db);
  if (!current.enabled) return { results: [], enabled: false };
  const row = selectedProviderRow(db);
  if (!row) return { results: [], enabled: false };
  const { results } = await runSearch({ baseUrl: row.base_url, apiKey: decrypt(row.api_key_encrypted), format: row.format, query, limit }, transport);
  return { results, enabled: true, provider: row.name };
}

function saveProvider(db, { baseUrl, apiKey, format }, transport = fetch) {
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
    db.prepare(`INSERT INTO web_search_providers(id,name,base_url,api_key_encrypted,format,updated_at)
      VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,api_key_encrypted=excluded.api_key_encrypted,format=excluded.format,updated_at=CURRENT_TIMESTAMP`)
      .run(id, name, normalizedBase, encrypt(key), fmt);
    db.prepare('UPDATE web_search_state SET selected_provider_id=?,enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(id);
    return { ...publicState(db), saved: { id, name, format: probe.format, sampleCount: probe.results.length } };
  })();
}

function removeProvider(db, id) {
  ensureSchema(db);
  const row = db.prepare('SELECT id FROM web_search_providers WHERE id=?').get(id);
  if (!row) throw Object.assign(new Error('Provider pencarian tidak ditemukan.'), { status: 404 });
  db.transaction(() => {
    db.prepare('DELETE FROM web_search_providers WHERE id=?').run(id);
    db.prepare('UPDATE web_search_state SET selected_provider_id=CASE WHEN selected_provider_id=? THEN NULL ELSE selected_provider_id END, enabled=CASE WHEN selected_provider_id=? THEN 0 ELSE enabled END, updated_at=CURRENT_TIMESTAMP WHERE id=1').run(id, id);
  })();
  return publicState(db);
}

function setSelected(db, id) {
  ensureSchema(db);
  const row = db.prepare('SELECT id FROM web_search_providers WHERE id=?').get(id);
  if (!row) throw Object.assign(new Error('Provider pencarian tidak ditemukan.'), { status: 404 });
  db.prepare('UPDATE web_search_state SET selected_provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(id);
  return publicState(db);
}

function setEnabled(db, enabled) {
  ensureSchema(db);
  if (typeof enabled !== 'boolean') throw Object.assign(new Error('Nilai enabled harus boolean.'), { status: 422 });
  if (enabled && !selectedProviderRow(db)) throw Object.assign(new Error('Simpan provider pencarian terlebih dahulu sebelum mengaktifkan.'), { status: 422 });
  db.prepare('UPDATE web_search_state SET enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(Number(enabled));
  return publicState(db);
}

function install({ app, db, transport = fetch }) {
  ensureSchema(db);

  app.get('/api/web-search/providers', (req, res) => res.json(publicState(db)));

  app.post('/api/web-search/providers', async (req, res, next) => {
    try { res.status(201).json(await saveProvider(db, { baseUrl: req.body?.baseUrl, apiKey: req.body?.apiKey, format: req.body?.format }, transport)); }
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
  setEnabled,
  searchForChat,
  runSearch,
  parseSearchResults,
  detectFormat,
  normalizeBaseUrl,
  buildSearchRequest,
  FORMATS
};
