const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');

const KNOWN_MODELS = Object.freeze([
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'gpt-5.5',
  'kimi-k2.6',
  'glm-5.2',
  'glm-5.1'
]);

const unique = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];

class AgentRouterProvider extends BaseProvider {
  rootBase() {
    return String(this.config.base_url || 'https://agentrouter.org')
      .replace(/\/$/, '')
      .replace(/\/v1(?:\/responses)?$/i, '');
  }

  endpoint(path = '') { return `${this.rootBase()}${path}`; }
  requestPath() { return '/v1/responses'; }
  healthPath() { return '/v1/models'; }
  selectedModel(input = {}) { return input.model || this.config.text_model || this.config.default_model || 'gpt-5.5'; }

  buildRequest(input = {}) {
    return {
      model: this.selectedModel(input),
      input: String(input.prompt || ''),
      stream: false
    };
  }

  parse(data = {}) {
    const usage = data.usage || {};
    const outputItems = Array.isArray(data.output) ? data.output : [];
    const nestedText = outputItems.flatMap(item => Array.isArray(item?.content) ? item.content : [])
      .map(item => item?.text || item?.output_text || '')
      .filter(Boolean)
      .join('');
    const content = data.output_text
      || nestedText
      || data.choices?.[0]?.message?.content
      || data.text
      || '';
    if (!content) {
      throw Object.assign(new Error('AgentRouter tidak mengembalikan respons teks'), { type: 'Provider Error', code: 'EMPTY_TEXT_RESPONSE' });
    }
    const promptTokens = usage.input_tokens || usage.prompt_tokens || 0;
    const completionTokens = usage.output_tokens || usage.completion_tokens || 0;
    return {
      content,
      media: [],
      providerJobId: data.id || null,
      providerRequestId: data.id || null,
      status: data.status || 'completed',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: usage.total_tokens || promptTokens + completionTokens
      },
      raw: data
    };
  }

  async execute(input, { signal, onProgress = () => {} } = {}) {
    if (input.mediaType && input.mediaType !== 'text') {
      throw Object.assign(new Error('AgentRouter agentrouter.org saat ini dikonfigurasi sebagai provider Text AI, bukan image/video generation.'), { status: 409, nonRetryable: true });
    }
    try {
      return await super.execute(input, { signal, onProgress });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async listModels(signal) {
    const response = await this.transport(this.endpoint(this.healthPath()), {
      method: 'GET',
      headers: this.headers(),
      signal
    });
    if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status });
    const payload = await response.json();
    const entries = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
    return unique([...KNOWN_MODELS, ...entries.map(entry => typeof entry === 'string' ? entry : entry?.id || entry?.model)]);
  }

  async testConnection({ signal } = {}) {
    const started = Date.now();
    try {
      const models = await this.listModels(signal);
      return {
        connected: true,
        providerVersion: 'Unified Responses API',
        defaultModel: this.config.text_model || this.config.default_model || models[0] || 'gpt-5.5',
        responseTime: Date.now() - started,
        models
      };
    } catch (error) {
      const status = Number(error.status || 0);
      if (status === 401 || status === 403) throw Object.assign(new Error('API key AgentRouter tidak valid'), { status, type: 'Authentication Error' });
      if (status === 402 || /insufficient|balance|saldo|credit/i.test(String(error.message || ''))) throw Object.assign(new Error('Saldo AgentRouter tidak mencukupi'), { status: status || 402, type: 'Quota Exceeded' });
      if (status === 429) throw Object.assign(new Error('Batas penggunaan AgentRouter tercapai'), { status, type: 'Rate Limited' });
      if (!status || error.type === 'Network Error') throw Object.assign(new Error('Tidak dapat menghubungi AgentRouter'), { status: 502, type: 'Network Error' });
      throw normalizeError(error);
    }
  }
}

AgentRouterProvider.KNOWN_MODELS = KNOWN_MODELS;
module.exports = AgentRouterProvider;
