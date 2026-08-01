const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');

const DEFAULT_BASE_URL = 'http://43.159.50.231:20130/v1';
function joinGatewayUrl(baseUrl, path = '') {
  let base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const suffix = String(path).replace(/^\/+/, '').replace(/^v1\//, '');
  if (suffix.startsWith('api/') && /\/v1$/.test(base)) base = base.slice(0, -3);
  return `${base}/${suffix}`;
}

class NineRouterProvider extends BaseProvider {
  endpoint(path = '') { return joinGatewayUrl(this.config.base_url, path); }
  headers() { const headers = { 'Content-Type': 'application/json' }; if (this.config.api_key) headers.Authorization = `Bearer ${this.config.api_key}`; return headers; }
  model(input = {}) { return input.model || this.config[`${input.mediaType || 'text'}_model`] || this.config.default_model; }
  requestPath(input = {}) { if (input.mediaType === 'image') return '/v1/images/generations'; if (input.mediaType === 'video') return '/v1/videos/generations'; return '/v1/chat/completions'; }
  buildRequest(input) { const model = this.model(input); return input.mediaType === 'text' || !input.mediaType ? { model, messages: [{ role: 'user', content: input.prompt }], stream: false } : { model, prompt: input.prompt, ...(input.mediaType === 'image' ? { size: input.parameters?.resolution || '1024x1024' } : {}) }; }
  parse(data, mediaType = 'text') {
    if (mediaType === 'image' || mediaType === 'video') { const media = data.data || data.images || data.videos || data.output || []; const items = (Array.isArray(media) ? media : [media]).map(item => typeof item === 'string' ? { url: item } : item); return { ...super.parse({ ...data, images: items }), content: '', providerJobId: data.id || data.task_id || null, status: data.status || 'completed' }; }
    const usage = data.usage || {}; return { content: data.choices?.[0]?.message?.content || '', media: [], providerJobId: data.id || null, status: data.status, usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0 }, raw: data };
  }
  async execute(input, { signal, onProgress = () => {} } = {}) { try { onProgress('Sending'); const response = await this.transport(this.endpoint(this.requestPath(input)), { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal }); if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status }); onProgress('Receiving'); return this.parse(await response.json(), input.mediaType); } catch (error) { throw normalizeError(error); } }
  healthPath() { return '/v1/models'; }
  async testConnection({ signal } = {}) { const started = Date.now(); const response = await this.transport(this.endpoint(this.healthPath()), { headers: this.headers(), signal }); if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status }); let payload; try { payload = await response.json(); } catch { throw Object.assign(new Error('Respons katalog model 9Router tidak valid'), { status: 502 }); } const { normalizeModels } = require('../services/nineRouterModels'); const models = normalizeModels(payload); return { connected: true, responseTime: Date.now() - started, providerVersion: response.headers.get('x-api-version') || 'Available', counts: Object.fromEntries(Object.entries(models).map(([key, value]) => [key, value.length])) }; }
}
NineRouterProvider.DEFAULT_BASE_URL = DEFAULT_BASE_URL;
NineRouterProvider.joinGatewayUrl = joinGatewayUrl;
module.exports = NineRouterProvider;
