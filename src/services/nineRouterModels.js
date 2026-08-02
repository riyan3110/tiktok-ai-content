const { NineRouterClient } = require('./nineRouterClient');

const CACHE_TTL = 10 * 60 * 1000;
const CATALOG_PATHS = Object.freeze({
  text: '/v1/models',
  image: '/v1/models/image',
  video: '/v1/models/video'
});

function idOf(item) {
  return String(typeof item === 'string' ? item : item?.id || '').trim();
}

function catalogFromPayload(payload) {
  if (payload?.object !== 'list' || !Array.isArray(payload.data)) {
    throw Object.assign(new Error('Respons katalog 9Router tidak valid'), { status: 502 });
  }

  const combos = [];
  const directModels = [];
  for (const item of payload.data) {
    const id = idOf(item);
    if (!id) continue;
    (item?.owned_by === 'combo' ? combos : directModels).push(id);
  }
  return {
    combos: [...new Set(combos)].sort(),
    directModels: [...new Set(directModels)].sort()
  };
}

async function fetchCatalogs(client, { signal } = {}) {
  const entries = await Promise.all(Object.entries(CATALOG_PATHS).map(async ([capability, path]) => {
    const response = await client.request(path, { signal });
    if (!response.ok) throw await client.responseError(response);
    let payload;
    try { payload = await response.json(); }
    catch { throw Object.assign(new Error('Respons katalog 9Router tidak valid'), { status: 502 }); }
    return [capability, catalogFromPayload(payload)];
  }));
  const result = Object.fromEntries(entries);
  result.capabilities = Object.keys(CATALOG_PATHS).filter(type => result[type].combos.length || result[type].directModels.length);
  result.counts = Object.fromEntries(Object.keys(CATALOG_PATHS).map(type => [type, result[type].combos.length + result[type].directModels.length]));
  result.endpoints = { ...CATALOG_PATHS };
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

  async get({ refresh = false, signal } = {}) {
    if (!refresh && this.cached && Date.now() - this.cached.at < this.ttl) return this.cached.value;
    const config = this.connector.configured(this.connector.setting(this.db, '9router'));
    const value = await fetchCatalogs(new NineRouterClient(config, this.transport), { signal });
    this.cached = { at: Date.now(), value };
    return value;
  }
}

module.exports = { NineRouterModels, catalogFromPayload, fetchCatalogs, CATALOG_PATHS, CACHE_TTL };
