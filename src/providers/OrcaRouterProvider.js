const BaseProvider = require('./BaseProvider');

class OrcaRouterProvider extends BaseProvider {
  requestPath() { return '/v1/chat/completions'; }
  buildRequest(input) {
    return {
      model: input.model || this.config.default_model || 'orcarouter/auto',
      messages: [{ role: 'user', content: input.prompt }],
      stream: false
    };
  }
  parse(data) {
    const usage = data.usage || {};
    return {
      content: data.choices?.[0]?.message?.content || '', media: [],
      providerJobId: data.id || null, status: data.status,
      usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0 },
      raw: data
    };
  }
  async testConnection(options = {}) {
    try { return await super.testConnection(options); }
    catch (error) {
      const status = Number(error.status || 0); const message = String(error.message || '');
      if (status === 401 || status === 403) throw Object.assign(new Error('API key OrcaRouter tidak valid'), { status, type: 'Authentication Error' });
      if (status === 402 || /insufficient|balance|saldo|credit/i.test(message)) throw Object.assign(new Error('Saldo OrcaRouter tidak mencukupi'), { status: status || 402, type: 'Quota Exceeded' });
      if (status === 404) throw Object.assign(new Error('Endpoint atau model OrcaRouter tidak ditemukan'), { status, type: 'Model Not Found' });
      if (status === 429) throw Object.assign(new Error('Batas penggunaan OrcaRouter tercapai'), { status, type: 'Rate Limited' });
      if (!status || error.type === 'Network Error') throw Object.assign(new Error('Tidak dapat menghubungi OrcaRouter'), { status: 502, type: 'Network Error' });
      throw error;
    }
  }
}

module.exports = OrcaRouterProvider;
