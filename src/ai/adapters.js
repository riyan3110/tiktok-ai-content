const { normalizeError } = require('./errors');

class ProviderAdapter {
  constructor(config, transport = fetch) { this.config = config; this.transport = transport; }
  get name() { return this.config.provider; }
  endpoint(path = '') { return `${this.config.base_url.replace(/\/$/, '')}${path}`; }
  headers() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.api_key}`,
    ...(this.config.organization_id ? { 'OpenAI-Organization': this.config.organization_id } : {}) }; }
  buildRequest({ prompt, model, stream = false }) { return { model: model || this.config.default_model, prompt, stream }; }
  requestPath() { return '/v1/generate'; }
  parse(data) { const content = data.output ?? data.text ?? data.content ?? data.result ?? data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage || {}; return { content: typeof content === 'string' ? content : JSON.stringify(content), usage: { promptTokens: usage.prompt_tokens || usage.input_tokens || 0, completionTokens: usage.completion_tokens || usage.output_tokens || 0, totalTokens: usage.total_tokens || 0 }, raw: data }; }
  async execute(input, { signal, onProgress = () => {} } = {}) {
    try { onProgress('Sending'); const pending = this.transport(this.endpoint(this.requestPath()), { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal }); onProgress('Waiting'); const response = await pending;
      if (!response.ok) { const body = await response.text(); throw Object.assign(new Error(body || `HTTP ${response.status}`), { status: response.status }); }
      onProgress('Receiving'); return this.parse(await response.json());
    } catch (error) { throw normalizeError(error); }
  }
  async testConnection({ signal } = {}) { const started = Date.now(); const response = await this.transport(this.endpoint(this.healthPath()), { headers: this.headers(), signal });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    const data = await response.json().catch(() => ({})); return { connected: true, providerVersion: data.version || response.headers.get('x-api-version') || 'Available', defaultModel: this.config.default_model, responseTime: Date.now() - started, info: data };
  }
  healthPath() { return '/v1/models'; }
}

class OpenAIAdapter extends ProviderAdapter { requestPath() { return '/v1/chat/completions'; } buildRequest({ prompt, model, stream = false }) { return { model: model || this.config.default_model, messages: [{ role: 'user', content: prompt }], stream }; } }
class ClaudeAdapter extends ProviderAdapter { requestPath() { return '/v1/messages'; } headers() { return { 'Content-Type': 'application/json', 'x-api-key': this.config.api_key, 'anthropic-version': '2023-06-01' }; } buildRequest({ prompt, model }) { return { model: model || this.config.default_model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] }; } parse(data) { return super.parse({ ...data, content: data.content?.map(x => x.text || '').join(''), usage: data.usage }); } }
class GeminiAdapter extends ProviderAdapter { requestPath() { return `/v1beta/models/${encodeURIComponent(this.config.default_model)}:generateContent?key=${encodeURIComponent(this.config.api_key)}`; } headers() { return { 'Content-Type': 'application/json' }; } buildRequest({ prompt }) { return { contents: [{ parts: [{ text: prompt }] }] }; } parse(data) { return super.parse({ ...data, content: data.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('') }); } }
class GenericMediaAdapter extends ProviderAdapter {}

const DEFINITIONS = Object.freeze({
  'google-flow': [GenericMediaAdapter, 'https://flow.googleapis.com', 'flow-default'], 'google-omni': [GenericMediaAdapter, 'https://generativelanguage.googleapis.com', 'omni-default'],
  openai: [OpenAIAdapter, 'https://api.openai.com', 'gpt-4o-mini'], claude: [ClaudeAdapter, 'https://api.anthropic.com', 'claude-3-5-sonnet-latest'],
  gemini: [GeminiAdapter, 'https://generativelanguage.googleapis.com', 'gemini-2.0-flash'], vidu: [GenericMediaAdapter, 'https://api.vidu.com', 'vidu-default'],
  runway: [GenericMediaAdapter, 'https://api.dev.runwayml.com', 'gen3a_turbo'], kling: [GenericMediaAdapter, 'https://api.klingai.com', 'kling-video'],
  pika: [GenericMediaAdapter, 'https://api.pika.art', 'pika-default'], hailuo: [GenericMediaAdapter, 'https://api.minimax.io', 'video-01'],
  custom: [ProviderAdapter, 'https://api.example.com', 'default']
});
class ProviderFactory {
  static names() { return Object.keys(DEFINITIONS); }
  static defaults(name) { const definition = DEFINITIONS[name]; if (!definition) throw new Error(`Unknown provider: ${name}`); return { baseUrl: definition[1], model: definition[2] }; }
  static create(config, transport) { const Adapter = (DEFINITIONS[config.provider] || DEFINITIONS.custom)[0]; return new Adapter(config, transport); }
}
module.exports = { ProviderAdapter, ProviderFactory, DEFINITIONS };
