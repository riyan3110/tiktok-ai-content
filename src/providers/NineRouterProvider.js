const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');
const { NineRouterClient, API_BASE_URL, gatewayUrl } = require('../services/nineRouterClient');

const DEFAULT_BASE_URL = API_BASE_URL;
function joinGatewayUrl(_baseUrl, path = '') { return gatewayUrl(path); }

class NineRouterProvider extends BaseProvider {
  constructor(config, transport = fetch) { super(config, transport); this.client = new NineRouterClient(config, transport); }
  endpoint(path = '') { return joinGatewayUrl(this.config.base_url, path); }
  headers() { return this.client.headers(true); }
  model(input = {}) { return input.model || this.config[`${input.mediaType || 'text'}_model`] || this.config.default_model; }
  requestPath(input = {}) { if (input.mediaType === 'image') return '/v1/images/generations'; if (input.mediaType === 'video') return '/v1/videos/generations'; return '/v1/chat/completions'; }
  buildRequest(input) { const model = this.model(input); return input.mediaType === 'text' || !input.mediaType ? { model, messages: [{ role: 'user', content: input.prompt }], stream: false } : { model, prompt: input.prompt, ...(input.mediaType === 'image' ? { size: input.parameters?.resolution || '1024x1024' } : {}) }; }
  parse(data, mediaType = 'text') {
    if (mediaType === 'image' || mediaType === 'video') { const media = data.data || data.images || data.videos || data.output || []; const items = (Array.isArray(media) ? media : [media]).map(item => typeof item === 'string' ? { url: item } : item); return { ...super.parse({ ...data, images: items }), content: '', providerJobId: data.id || data.task_id || null, status: data.status || 'completed' }; }
    const usage = data.usage || {}; return { content: data.choices?.[0]?.message?.content || '', media: [], providerJobId: data.id || null, status: data.status, usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0 }, raw: data };
  }
  async execute(input, { signal, onProgress = () => {} } = {}) { try { onProgress('Sending'); const response = await this.client.request(this.requestPath(input), { method: 'POST', body: JSON.stringify(this.buildRequest(input)), signal }); if (!response.ok) throw await this.client.responseError(response); onProgress('Receiving'); return this.parse(await response.json(), input.mediaType); } catch (error) { throw normalizeError(error); } }
  healthPath() { return '/v1/models'; }
  async testConnection({ signal } = {}) { const started = Date.now(); const { fetchCatalogs } = require('../services/nineRouterModels'); const catalog = await fetchCatalogs(this.client, { signal }); return { connected: true, responseTime: Date.now() - started, providerVersion: 'Available', counts: catalog.counts, capabilities: catalog.capabilities }; }
}
NineRouterProvider.DEFAULT_BASE_URL = DEFAULT_BASE_URL;
NineRouterProvider.joinGatewayUrl = joinGatewayUrl;
module.exports = NineRouterProvider;
