const { NineRouterClient } = require('./nineRouterClient');
const CACHE_TTL = 10 * 60 * 1000;
const MODELS_PATH = '/v1/models';
const CAPABILITIES = ['text', 'image', 'video'];
const fields = ['capability', 'capabilities', 'modality', 'modalities', 'type', 'service', 'service_type', 'service_kind', 'endpoint', 'input_modalities', 'output_modalities'];
const values = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.entries(value).filter(([, enabled]) => enabled).map(([name]) => name) : value == null ? [] : [value];
const idOf = item => String(typeof item === 'string' ? item : item?.id || item?.name || item?.model || '').trim();

function capabilitiesFromMetadata(item = {}) {
  const sources = [item, item.architecture, item.config, item.service].filter(value => value && typeof value === 'object');
  const result = new Set();
  for (const value of sources.flatMap(source => fields.flatMap(field => values(source[field]))).map(String).map(value => value.toLowerCase())) {
    if (/text|chat|language|completion/.test(value)) result.add('text');
    if (/image/.test(value)) result.add('image');
    if (/video/.test(value)) result.add('video');
  }
  return result;
}
function registryCapabilities(id) {
  const value = String(id).toLowerCase();
  if (/(^|\/)(sora|veo|kling|vidu|hailuo|wan[^/]*video|runway|luma|minimax-video)/.test(value)) return new Set(['video']);
  if (/(^|\/)(gpt-image|dall-e|imagen|flux|ideogram|recraft|stable-diffusion|sdxl|qwen-image)/.test(value)) return new Set(['image']);
  if (/(deepseek|(^|\/)(openai\/)?gpt-|qwen[^/]*(chat|coder|instruct)|claude|gemini|llama|mistral)/.test(value)) return new Set(['text']);
  return new Set();
}
function modelCapabilities(model) { const official = capabilitiesFromMetadata(model); return official.size ? official : registryCapabilities(idOf(model)); }
function payloadItems(payload, keys) { if (Array.isArray(payload)) return payload; for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key]; if (payload?.data && !Array.isArray(payload.data)) for (const key of keys) if (Array.isArray(payload.data[key])) return payload.data[key]; throw new Error('Respons katalog 9Router tidak valid'); }
function normalized(result) { for (const key of Object.keys(result)) result[key] = [...new Set(result[key])].sort(); return result; }
function normalizeModels(payload) {
  const result = { text: [], image: [], video: [], unknown: [] };
  for (const model of payloadItems(payload, ['data', 'models', 'items'])) { const id = idOf(model); if (!id) continue; const capabilities = modelCapabilities(model); if (!capabilities.size) result.unknown.push(id); for (const capability of capabilities) result[capability].push(id); }
  return normalized(result);
}
function combosPayload(payload) { return Array.isArray(payload?.combos) ? payload.combos : Array.isArray(payload?.data?.combos) ? payload.data.combos : []; }
function comboMembers(combo) { return ['models', 'members', 'routes', 'targets', 'candidates'].flatMap(key => values(combo?.[key])).flatMap(member => typeof member === 'string' ? [member] : [member?.model, member?.model_id, member?.id, member?.target].filter(Boolean)).map(String); }
function normalizeCombos(payload, directPayload) {
  const directItems = payloadItems(directPayload, ['data', 'models', 'items']); const directById = new Map(directItems.map(item => [idOf(item), item]));
  const result = { text: [], image: [], video: [], unknown: [] };
  for (const combo of payloadItems(payload, ['data', 'combos', 'routers', 'items'])) { const id = idOf(combo); if (!id) continue; let capabilities = capabilitiesFromMetadata(combo); if (!capabilities.size) { capabilities = new Set(); for (const memberId of comboMembers(combo)) for (const capability of modelCapabilities(directById.get(memberId) || { id: memberId })) capabilities.add(capability); } if (!capabilities.size) result.unknown.push(id); for (const capability of capabilities) result[capability].push(id); }
  return normalized(result);
}
function discovery(combos, direct) {
  const result = {}; for (const capability of CAPABILITIES) result[capability] = { combos: combos[capability], directModels: direct[capability] };
  result.unknown = { combos: combos.unknown, directModels: direct.unknown }; result.capabilities = CAPABILITIES.filter(type => result[type].combos.length || result[type].directModels.length); result.counts = Object.fromEntries(CAPABILITIES.map(type => [type, result[type].combos.length + result[type].directModels.length])); result.endpoints = { models: MODELS_PATH }; return result;
}
function catalogFromPayload(payload) { return discovery(normalizeCombos(combosPayload(payload), payload), normalizeModels(payload)); }
class NineRouterModels {
  constructor({ db, connector, transport = fetch, ttl = CACHE_TTL }) { this.db = db; this.connector = connector; this.transport = transport; this.ttl = ttl; this.cached = null; }
  async get({ refresh = false } = {}) { if (!refresh && this.cached && Date.now() - this.cached.at < this.ttl) return this.cached.value; const config = this.connector.configured(this.connector.setting(this.db, '9router')); const client = new NineRouterClient(config, this.transport); const response = await client.request(MODELS_PATH); if (!response.ok) throw await client.responseError(response); let payload; try { payload = await response.json(); } catch { throw Object.assign(new Error('Respons katalog 9Router tidak valid'), { status: 502 }); } const value = catalogFromPayload(payload); this.cached = { at: Date.now(), value }; return value; }
}
module.exports = { NineRouterModels, normalizeModels, normalizeCombos, modelCapabilities, discovery, catalogFromPayload, MODELS_PATH, CACHE_TTL };
