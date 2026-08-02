const NineRouterClient = require('../providers/NineRouterProvider');

const CACHE_TTL = 10 * 60 * 1000;
const CATALOG_PATHS = Object.freeze({
  text: '/v1/models',
  image: '/v1/models/image',
  video: '/v1/models/video'
});

const idOf = entry => String(typeof entry === 'string' ? entry : entry?.id || '').trim();

function normalizeCatalog(payload) {
  if (!payload || payload.object !== 'list' || !Array.isArray(payload.data)) {
    throw Object.assign(new Error('Respons katalog 9Router tidak valid'), { status: 502 });
  }

  const result = { combos: [], directModels: [] };
  for (const entry of payload.data) {
    const id = idOf(entry);
    if (!id) continue;
    const group = entry?.owned_by === 'combo' ? 'combos' : 'directModels';
    result[group].push(id);
  }
  result.combos = [...new Set(result.combos)].sort();
  result.directModels = [...new Set(result.directModels)].sort();
  return result;
}

function discovery(payloads) {
  const result = Object.fromEntries(Object.keys(CATALOG_PATHS).map(type => [type, normalizeCatalog(payloads[type])]));
  result.capabilities = Object.keys(CATALOG_PATHS).filter(type => result[type].combos.length || result[type].directModels.length);
  result.counts = Object.fromEntries(Object.keys(CATALOG_PATHS).map(type => [type, result[type].combos.length + result[type].directModels.length]));
  return result;
}

class NineRouterModels {
  constructor({ db, connector, transport = fetch, ttl = CACHE_TTL }) {
    this.db = db;
    this.connector = connector;
    this.transport = transport;
    this.ttl = ttl;
    this.cached = null;
  }

  async fetchCatalog(client, path) {
    const response = await client.transport(client.endpoint(path), {
      headers: { ...client.headers(), Accept: 'application/json' }
    });
    if (!response.ok) {
      throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status });
    }
    try {
      return await response.json();
    } catch {
      throw Object.assign(new Error('Respons katalog 9Router tidak valid'), { status: 502 });
    }
  }

  async get({ refresh = false } = {}) {
    if (!refresh && this.cached && Date.now() - this.cached.at < this.ttl) return this.cached.value;
    const config = this.connector.configured(this.connector.setting(this.db, '9router'));
    const client = new NineRouterClient(config, this.transport);
    const entries = await Promise.all(Object.entries(CATALOG_PATHS).map(async ([type, path]) => [type, await this.fetchCatalog(client, path)]));
    const value = discovery(Object.fromEntries(entries));
    this.cached = { at: Date.now(), value };
    return value;
  }
}

module.exports = { NineRouterModels, normalizeCatalog, discovery, CATALOG_PATHS, CACHE_TTL };
