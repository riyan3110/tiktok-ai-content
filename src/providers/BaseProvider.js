const { normalizeError } = require('../ai/errors');
class BaseProvider {
  constructor(config, transport = fetch) { this.config = config; this.transport = transport; }
  get name() { return this.config.provider; }
  endpoint(path = '') { return `${this.config.base_url.replace(/\/$/, '')}${path}`; }
  headers() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.api_key}` }; }
  requestPath() { return '/v1/generate'; } healthPath() { return '/v1/models'; }
  buildRequest(input) { return { model: input.model || this.config.default_model, prompt: input.prompt, negativePrompt: input.parameters?.negativePrompt, referenceAssets: input.assets || [], aspectRatio: input.parameters?.aspectRatio, duration: input.parameters?.duration, resolution: input.parameters?.resolution, style: input.parameters?.style, seed: input.parameters?.seed, type: input.mediaType }; }
  parse(data) { const media = data.media || data.images || data.videos || (data.url ? [{ url: data.url }] : []); const usage = data.usage || {}; return { content: data.output || data.text || '', media: Array.isArray(media) ? media : [media], providerJobId: data.id || data.job_id || data.task_id || null, status: data.status, usage: { promptTokens: usage.promptTokens || usage.prompt_tokens || usage.input_tokens || 0, completionTokens: usage.completionTokens || usage.completion_tokens || usage.output_tokens || 0, totalTokens: usage.totalTokens || usage.total_tokens || 0 }, raw: data }; }
  async execute(input, { signal, onProgress = () => {} } = {}) { try { onProgress('Sending'); const response = await this.transport(this.endpoint(this.requestPath(input)), { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal }); if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status }); onProgress('Receiving'); return this.parse(await response.json()); } catch (error) { throw normalizeError(error); } }
  async testConnection({ signal } = {}) { const started = Date.now(); const response = await this.transport(this.endpoint(this.healthPath()), { headers: this.headers(), signal }); if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status }); return { connected: true, providerVersion: response.headers.get('x-api-version') || 'Available', defaultModel: this.config.default_model, responseTime: Date.now() - started }; }
}
module.exports = BaseProvider;
