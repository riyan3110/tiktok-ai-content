const { joinGatewayUrl } = require('../providers/NineRouterProvider');

const CACHE_TTL = 10 * 60 * 1000;
const CATALOG_PATHS = Object.freeze({
  text: '/v1/models',
  image: '/v1/models/image',
  video: '/v1/models/video'
});
const CAPABILITIES = Object.keys(CATALOG_PATHS);
const idOf = item => String(typeof item === 'string' ? item : item?.id || '').trim();

function payloadItems(payload) {
  if (!payload || !Array.isArray(payload.data)) throw new Error('Respons katalog 9Router tidak valid');
  return payload.data;
}

function normalizeCatalog(payload) {
  const result = { combos: [], directModels: [] };
  for (const item of payloadItems(payload)) {
    const id = idOf(item);
    if (!id) continue;
    result[item?.owned_by === 'combo' ? 'combos' : 'directModels'].push(id);
  }
  result.combos = [...new Set(result.combos)].sort();
  result.directModels = [...new Set(result.directModels)].sort();
  return result;
}

// Kept for the connection check, which reports the text catalog size.
function normalizeModels(payload) {
  const catalog = normalizeCatalog(payload);
  return { text: [...catalog.combos, ...catalog.directModels], image: [], video: [], unknown: [] };
}

function discovery(payloads) {
  const result = Object.fromEntries(CAPABILITIES.map(type => [type, normalizeCatalog(payloads[type])]));
  result.capabilities = CAPABILITIES.filter(type => result[type].combos.length || result[type].directModels.length);
  result.counts = Object.fromEntries(CAPABILITIES.map(type => [type, result[type].combos.length + result[type].directModels.length]));
  result.endpoints = { ...CATALOG_PATHS };
  return result;
}

class NineRouterModels {
  constructor({ db, connector, transport = fetch, ttl = CACHE_TTL }) { this.db = db; this.connector = connector; this.transport = transport; this.ttl = ttl; this.cached = null; }
  async fetchJson(config, path, headers) { const response = await this.transport(joinGatewayUrl(config.base_url, path), { headers }); if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status }); try { return await response.json(); } catch { throw Object.assign(new Error('Respons katalog 9Router tidak valid'), { status: 502 }); } }
  async get({ refresh = false } = {}) {
    if (!refresh && this.cached && Date.now() - this.cached.at < this.ttl) return this.cached.value;
    const config = this.connector.configured(this.connector.setting(this.db, '9router'));
    const headers = { Accept: 'application/json' };
    if (config.api_key) headers.Authorization = `Bearer ${config.api_key}`;
    const responses = await Promise.all(CAPABILITIES.map(type => this.fetchJson(config, CATALOG_PATHS[type], headers)));
    const value = discovery(Object.fromEntries(CAPABILITIES.map((type, index) => [type, responses[index]])));
    this.cached = { at: Date.now(), value };
    return value;
  }
}

module.exports = { NineRouterModels, normalizeCatalog, normalizeModels, discovery, CATALOG_PATHS, CACHE_TTL };
