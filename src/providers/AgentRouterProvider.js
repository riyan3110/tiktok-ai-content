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
  openAiBase() {
    const raw = String(this.config.base_url || 'https://co.agentrouter.org/v1').replace(/\/$/, '');
    return /\/v1$/i.test(raw) ? raw : `${raw}/v1`;
  }

  anthropicBase() {
    return String(this.config.base_url || 'https://co.agentrouter.org/v1').replace(/\/$/, '').replace(/\/v1$/i, '');
  }

  endpoint(path = '') { return `${this.openAiBase()}${path}`; }
  requestPath() { return '/chat/completions'; }
  healthPath() { return '/models'; }
  selectedModel(input = {}) { return input.model || this.config.text_model || this.config.default_model || 'gpt-5.5'; }

  buildRequest(input = {}) {
    return {
      model: this.selectedModel(input),
      messages: [{ role: 'user', content: input.prompt }],
      stream: false
    };
  }

  parse(data = {}) {
    const usage = data.usage || {};
    const content = data.choices?.[0]?.message?.content || data.output_text || '';
    if (!content && !data.choices?.length) {
      throw Object.assign(new Error('AgentRouter tidak mengembalikan respons teks'), { type: 'Provider Error', code: 'EMPTY_TEXT_RESPONSE' });
    }
    return {
      content,
      media: [],
      providerJobId: data.id || null,
      providerRequestId: data.id || null,
      status: data.status || 'completed',
      usage: {
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || ((usage.prompt_tokens || usage.input_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0))
      },
      raw: data
    };
  }

  parseClaude(data = {}) {
    const usage = data.usage || {};
    const content = Array.isArray(data.content)
      ? data.content.filter(item => item?.type === 'text').map(item => item.text || '').join('')
      : '';
    if (!content) throw Object.assign(new Error('AgentRouter Claude tidak mengembalikan respons teks'), { type: 'Provider Error', code: 'EMPTY_TEXT_RESPONSE' });
    return {
      content,
      media: [],
      providerJobId: data.id || null,
      providerRequestId: data.id || null,
      status: data.stop_reason ? 'completed' : (data.status || 'completed'),
      usage: {
        promptTokens: usage.input_tokens || 0,
        completionTokens: usage.output_tokens || 0,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
      },
      raw: data
    };
  }

  async execute(input, { signal, onProgress = () => {} } = {}) {
    if (input.mediaType && input.mediaType !== 'text') {
      throw Object.assign(new Error('AgentRouter co.agentrouter.org saat ini dikonfigurasi sebagai provider Text AI, bukan image/video generation.'), { status: 409, nonRetryable: true });
    }
    const model = this.selectedModel(input);
    if (!isClaudeModel(model)) return super.execute(input, { signal, onProgress });

    try {
      onProgress('Sending');
      const response = await this.transport(`${this.anthropicBase()}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.api_key}`,
          'x-api-key': this.config.api_key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: Math.max(1, Math.min(8192, Number(input.parameters?.maxTokens) || 4096)),
          messages: [{ role: 'user', content: input.prompt }]
        }),
        signal
      });
      if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status });
      onProgress('Receiving');
      return this.parseClaude(await response.json());
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
        providerVersion: 'OpenAI + Anthropic Compatible',
        defaultModel: this.config.text_model || this.config.default_model || models[0] || 'gpt-5.5',
        responseTime: Date.now() - started,
        models
      };
    } catch (error) {
      const status = Number(error.status || 0);
      if (status === 401 || status === 403) throw Object.assign(new Error('API key AgentRouter tidak valid atau tidak diizinkan untuk endpoint model'), { status, type: 'Authentication Error' });
      if (status === 402 || /insufficient|balance|saldo|credit/i.test(String(error.message || ''))) throw Object.assign(new Error('Saldo AgentRouter tidak mencukupi'), { status: status || 402, type: 'Quota Exceeded' });
      if (status === 429) throw Object.assign(new Error('Batas penggunaan AgentRouter tercapai'), { status, type: 'Rate Limited' });
      if (!status || error.type === 'Network Error') throw Object.assign(new Error('Tidak dapat menghubungi AgentRouter'), { status: 502, type: 'Network Error' });
      throw normalizeError(error);
    }
  }
}

AgentRouterProvider.KNOWN_MODELS = KNOWN_MODELS;
AgentRouterProvider.isClaudeModel = isClaudeModel;
module.exports = AgentRouterProvider;
