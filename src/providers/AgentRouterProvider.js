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
const isClaudeModel = model => /^claude-/i.test(String(model || '').trim());

class AgentRouterProvider extends BaseProvider {
  rootBase() {
    const raw = String(this.config.base_url || 'https://co.agentrouter.org')
      .replace(/\/$/, '')
      .replace(/\/v1(?:\/(?:responses|chat\/completions|messages|models))?$/i, '');
    try {
      const url = new URL(raw);
      if (url.hostname === 'agentrouter.org' || url.hostname === 'www.agentrouter.org') return 'https://co.agentrouter.org';
    } catch (_) {}
    return raw;
  }

  endpoint(path = '') { return `${this.rootBase()}${path}`; }
  selectedModel(input = {}) { return input.model || this.config.text_model || this.config.default_model || 'gpt-5.5'; }
  requestPath(input = {}) { return isClaudeModel(this.selectedModel(input)) ? '/v1/messages' : '/v1/chat/completions'; }

  openAiHeaders() {
    return { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${this.config.api_key}` };
  }

  anthropicHeaders() {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.api_key}`,
      'anthropic-version': '2023-06-01'
    };
  }

  buildOpenAiRequest(input = {}, probe = false) {
    const body = {
      model: this.selectedModel(input),
      messages: [{ role: 'user', content: String(input.prompt || '') }],
      stream: false
    };
    const maxTokens = probe ? 1 : Number(input.parameters?.maxTokens || 0);
    if (maxTokens > 0) body.max_tokens = Math.max(1, Math.min(8192, maxTokens));
    return body;
  }

  buildClaudeRequest(input = {}, probe = false) {
    return {
      model: this.selectedModel(input),
      max_tokens: probe ? 1 : Math.max(1, Math.min(8192, Number(input.parameters?.maxTokens) || 4096)),
      messages: [{ role: 'user', content: String(input.prompt || '') }]
    };
  }

  parseOpenAi(data = {}) {
    const usage = data.usage || {};
    const content = data.choices?.[0]?.message?.content || data.output_text || '';
    if (!content) throw Object.assign(new Error('AgentRouter tidak mengembalikan respons teks'), { type: 'Provider Error', code: 'EMPTY_TEXT_RESPONSE' });
    const promptTokens = usage.prompt_tokens || usage.input_tokens || 0;
    const completionTokens = usage.completion_tokens || usage.output_tokens || 0;
    return {
      content,
      media: [],
      providerJobId: data.id || null,
      providerRequestId: data.id || null,
      status: data.status || 'completed',
      usage: { promptTokens, completionTokens, totalTokens: usage.total_tokens || promptTokens + completionTokens },
      raw: data
    };
  }

  parseClaude(data = {}) {
    const usage = data.usage || {};
    const content = Array.isArray(data.content)
      ? data.content.filter(item => item?.type === 'text').map(item => item.text || '').join('')
      : (typeof data.content === 'string' ? data.content : '');
    if (!content) throw Object.assign(new Error('AgentRouter Claude tidak mengembalikan respons teks'), { type: 'Provider Error', code: 'EMPTY_TEXT_RESPONSE' });
    const promptTokens = usage.input_tokens || 0;
    const completionTokens = usage.output_tokens || 0;
    return {
      content,
      media: [],
      providerJobId: data.id || null,
      providerRequestId: data.id || null,
      status: data.stop_reason ? 'completed' : (data.status || 'completed'),
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      raw: data
    };
  }

  async requestJson(url, options) {
    const response = await this.transport(url, options);
    const text = await response.text();
    if (!response.ok) {
      let message = text || `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text);
        message = parsed?.error?.message || parsed?.message || parsed?.error || message;
      } catch (_) {}
      throw Object.assign(new Error(String(message)), { status: response.status, endpoint: url });
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      const html = /^\s*</.test(text) || /<!doctype|<html/i.test(text);
      throw Object.assign(new Error(html
        ? `AgentRouter mengembalikan halaman HTML, bukan respons API JSON (${url})`
        : `Respons AgentRouter bukan JSON yang valid (${url})`), { status: 502, endpoint: url, nonRetryable: true });
    }
    return data;
  }

  async execute(input, { signal, onProgress = () => {} } = {}) {
    if (input.mediaType && input.mediaType !== 'text') {
      throw Object.assign(new Error('AgentRouter saat ini dikonfigurasi sebagai provider Text AI, bukan image/video generation.'), { status: 409, nonRetryable: true });
    }

    const claude = isClaudeModel(this.selectedModel(input));
    const url = this.endpoint(claude ? '/v1/messages' : '/v1/chat/completions');
    try {
      onProgress('Sending');
      const data = await this.requestJson(url, {
        method: 'POST',
        headers: claude ? this.anthropicHeaders() : this.openAiHeaders(),
        body: JSON.stringify(claude ? this.buildClaudeRequest(input) : this.buildOpenAiRequest(input)),
        signal
      });
      onProgress('Receiving');
      return claude ? this.parseClaude(data) : this.parseOpenAi(data);
    } catch (error) {
      error.endpoint ||= url;
      throw normalizeError(error);
    }
  }

  async testConnection({ signal } = {}) {
    const started = Date.now();
    const model = this.config.text_model || this.config.default_model || 'gpt-5.5';
    const claude = isClaudeModel(model);
    const url = this.endpoint(claude ? '/v1/messages' : '/v1/chat/completions');
    try {
      const data = await this.requestJson(url, {
        method: 'POST',
        headers: claude ? this.anthropicHeaders() : this.openAiHeaders(),
        body: JSON.stringify(claude
          ? this.buildClaudeRequest({ model, prompt: 'Reply OK' }, true)
          : this.buildOpenAiRequest({ model, prompt: 'Reply OK' }, true)),
        signal
      });
      const parsed = claude ? this.parseClaude(data) : this.parseOpenAi(data);
      if (!parsed.content) throw Object.assign(new Error('AgentRouter tidak mengembalikan probe teks'), { status: 502 });
      return {
        connected: true,
        providerVersion: claude ? 'Anthropic Messages' : 'OpenAI Chat Completions',
        defaultModel: model,
        responseTime: Date.now() - started,
        models: unique(KNOWN_MODELS)
      };
    } catch (error) {
      const status = Number(error.status || 0);
      const message = String(error.message || '');
      if (status === 401 || status === 403) throw Object.assign(new Error(message || 'API key AgentRouter tidak valid'), { status, type: 'Authentication Error' });
      if (status === 402 || /insufficient|balance|saldo|credit/i.test(message)) throw Object.assign(new Error('Saldo AgentRouter tidak mencukupi'), { status: status || 402, type: 'Quota Exceeded' });
      if (status === 404) throw Object.assign(new Error(`Endpoint AgentRouter tidak ditemukan: ${url}`), { status, type: 'Provider Error' });
      if (status === 429) throw Object.assign(new Error('Batas penggunaan AgentRouter tercapai'), { status, type: 'Rate Limited' });
      if (!status || error.type === 'Network Error') throw Object.assign(new Error(`Tidak dapat menghubungi AgentRouter (${url})`), { status: 502, type: 'Network Error' });
      throw normalizeError(error);
    }
  }
}

AgentRouterProvider.KNOWN_MODELS = KNOWN_MODELS;
AgentRouterProvider.isClaudeModel = isClaudeModel;
module.exports = AgentRouterProvider;
