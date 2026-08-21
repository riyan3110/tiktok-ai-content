const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');

const unique = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];

class AgentRouterProvider extends BaseProvider {
  requestPath() { return '/chat/completions'; }
  healthPath() { return '/models'; }

  buildRequest(input = {}) {
    return {
      model: input.model || this.config.text_model || this.config.default_model || 'gpt-5.5',
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
        totalTokens: usage.total_tokens || 0
      },
      raw: data
    };
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
    return unique(entries.map(entry => typeof entry === 'string' ? entry : entry?.id || entry?.model));
  }

  async testConnection({ signal } = {}) {
    const started = Date.now();
    try {
      const models = await this.listModels(signal);
      return {
        connected: true,
        providerVersion: 'OpenAI Compatible',
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

module.exports = AgentRouterProvider;
