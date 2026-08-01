const CACHE_TTL = 10 * 60 * 1000;
const FALLBACK = Object.freeze({ text: ['orcarouter/auto'], image: ['openai/gpt-image-1', 'openai/gpt-image-1.5'], video: ['kling/kling-v2-6', 'kling/kling-v3', 'kling/kling-v3-omni', 'byteplus/seedance-1-5-pro'] });
const values = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.entries(value).filter(([, enabled]) => enabled).map(([name]) => name) : value ? [value] : [];
function capabilities(model) {
  const metadata = [model.capabilities, model.modalities, model.supported_modalities, model.architecture?.modalities, model.architecture?.input_modalities, model.architecture?.output_modalities, model.input_modalities, model.output_modalities, model.type].flatMap(values).map(value => String(value).toLowerCase());
  const result = new Set();
  for (const capability of metadata) { if (/image|vision/.test(capability)) result.add('image'); if (/video/.test(capability)) result.add('video'); if (/text|chat|language/.test(capability)) result.add('text'); }
  return result;
}
function normalize(payload) {
  const models = Array.isArray(payload) ? payload : payload?.data || payload?.models || []; const output = { text: [], image: [], video: [], unverified: [] };
  for (const model of models) { const id = String(typeof model === 'string' ? model : model.id || model.name || '').trim(); if (!id) continue; const verified = capabilities(typeof model === 'string' ? { id } : model); if (!verified.size) output.unverified.push(id); for (const type of verified) output[type]?.push(id); }
  for (const type of Object.keys(output)) output[type] = [...new Set(output[type])].sort(); if (!output.unverified.length) delete output.unverified; return output;
}
class OrcaRouterModels {
  constructor({ db, connector, transport = fetch, ttl = CACHE_TTL }) { this.db = db; this.connector = connector; this.transport = transport; this.ttl = ttl; this.cached = null; }
  async get({ refresh = false } = {}) {
    if (!refresh && this.cached && Date.now() - this.cached.at < this.ttl) return this.cached.value;
    try { const row = this.connector.setting(this.db, 'orcarouter'); if (!row.api_key_encrypted) throw new Error('API key OrcaRouter belum tersedia'); const config = this.connector.configured(row); const response = await this.transport(`${String(config.base_url).replace(/\/$/, '')}/v1/models`, { headers: { Authorization: `Bearer ${config.api_key}`, Accept: 'application/json' } }); if (!response.ok) throw new Error(`HTTP ${response.status}`); const value = { ...normalize(await response.json()), fallback: false, error: null }; this.cached = { at: Date.now(), value }; return value; }
    catch { const value = { text: [...FALLBACK.text], image: [...FALLBACK.image], video: [...FALLBACK.video], fallback: true, error: 'Daftar model OrcaRouter gagal dimuat.' }; this.cached = { at: Date.now(), value }; return value; }
  }
}
module.exports = { OrcaRouterModels, normalize, capabilities, FALLBACK, CACHE_TTL };
