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

const emptyCatalog = () => ({ combos: [], directModels: [] });

function catalogError(type, error) {
  const status = error?.status || 500;
  const unavailable = status === 404 && type === 'video';
  return {
    status,
    message: unavailable
      ? '9Router tidak menyediakan katalog model video.'
      : error?.message || `Katalog model ${type} 9Router gagal dimuat.`
  };
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
    const row = this.connector.setting(this.db, '9router');
    if (!row.api_key_encrypted) throw Object.assign(new Error('API key is required'), { status: 422 });
    const config = this.connector.configured(row);
    const client = new NineRouterClient(config, this.transport);
    const types = Object.keys(CATALOG_PATHS);
    const settled = await Promise.allSettled(types.map(async type => normalizeCatalog(await this.fetchCatalog(client, CATALOG_PATHS[type]))));
    const textResult = settled[types.indexOf('text')];
    if (textResult.status === 'rejected') throw textResult.reason;

    const value = { errors: { image: null, video: null } };
    for (const [index, type] of types.entries()) {
      const result = settled[index];
      if (result.status === 'fulfilled') {
        value[type] = result.value;
      } else {
        value[type] = emptyCatalog();
        value.errors[type] = catalogError(type, result.reason);
      }
    }
    value.capabilities = types.filter(type => value[type].combos.length || value[type].directModels.length);
    value.counts = Object.fromEntries(types.map(type => [type, value[type].combos.length + value[type].directModels.length]));
    this.cached = { at: Date.now(), value };
    return value;
  }
}

module.exports = { NineRouterModels, normalizeCatalog, discovery, catalogError, CATALOG_PATHS, CACHE_TTL };
