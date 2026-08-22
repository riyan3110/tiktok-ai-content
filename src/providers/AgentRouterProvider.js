const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');

const KNOWN_MODELS = Object.freeze([
  'deepseek-ai/deepseek-v4-flash',
  'deepseek/deepseek-reasoner',
  'z-ai/glm-5.1',
  'z-ai/glm-5.2',
  'claude-haiku',
  'claude-sonnet'
]);

const unique = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];

class AgentRouterProvider extends BaseProvider {
  rootBase() {
    return String(this.config.base_url || 'https://api.bluesminds.com/v1')
      .replace(/\/$/, '')
      .replace(/\/chat\/completions$/i, '');
  }

  endpoint(path = '') { return `${this.rootBase()}${path}`; }
  selectedModel(input = {}) { return input.model || this.config.text_model || this.config.default_model || 'deepseek-ai/deepseek-v4-flash'; }
  requestPath() { return '/chat/completions'; }

  headers() {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${this.config.api_key}`
    };
  }

  imageParts(input = {}) {
    return (Array.isArray(input.assets) ? input.assets : []).map(asset => {
      if (!asset) return null;
      if (typeof asset === 'string') return { type: 'image_url', image_url: { url: asset } };
      if (asset.url) return { type: 'image_url', image_url: { url: asset.url } };
      if (asset.data) {
        const mime = asset.mimeType || asset.mime_type || 'image/jpeg';
        return { type: 'image_url', image_url: { url: `data:${mime};base64,${asset.data}` } };
      }
      return null;
    }).filter(Boolean);
  }

  chatMessages(input = {}) {
    const supplied = Array.isArray(input.messages) ? input.messages : [];
    const messages = supplied
      .map(message => ({
        role: ['system', 'user', 'assistant'].includes(message?.role) ? message.role : 'user',
        content: message?.content ?? ''
      }))
      .filter(message => String(message.content ?? '').trim() || Array.isArray(message.content));

    if (!messages.length) {
      messages.push({ role: 'user', content: String(input.prompt || '') });
    }

    const images = this.imageParts(input);
    if (images.length) {
      let userIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'user') { userIndex = index; break; }
      }
      if (userIndex < 0) {
        messages.push({ role: 'user', content: [{ type: 'text', text: '' }, ...images] });
      } else {
        const current = messages[userIndex].content;
        const content = Array.isArray(current)
          ? [...current, ...images]
          : [{ type: 'text', text: String(current || '') }, ...images];
        messages[userIndex] = { ...messages[userIndex], content };
      }
    }

    return messages;
  }

  buildRequest(input = {}, probe = false) {
    const body = {
      model: this.selectedModel(input),
      messages: this.chatMessages(input),
      stream: false
    };
    const maxTokens = probe ? 8 : Number(input.parameters?.maxTokens || 0);
    if (maxTokens > 0) body.max_tokens = Math.max(1, Math.min(8192, maxTokens));
    return body;
  }

  parseResponse(data = {}) {
    const usage = data.usage || {};
    const rawContent = data.choices?.[0]?.message?.content ?? data.output_text ?? '';
    const content = Array.isArray(rawContent)
      ? rawContent.map(part => typeof part === 'string' ? part : (part?.text || part?.content || '')).join('').trim()
      : String(rawContent || '').trim();
    if (!content) throw Object.assign(new Error('BluesMinds tidak mengembalikan respons teks'), { type: 'Provider Error', code: 'EMPTY_TEXT_RESPONSE' });
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

  async requestJson(url, options) {
    const response = await this.transport(url, options);
    const text = await response.text();
    if (!response.ok) {
      const html = /^\s*</.test(text) || /<!doctype|<html/i.test(text);
      let message = html ? `BluesMinds gateway error (HTTP ${response.status})` : (text || `HTTP ${response.status}`);
      if (!html) {
        try {
          const parsed = JSON.parse(text);
          message = parsed?.error?.message || parsed?.message || parsed?.error || message;
        } catch (_) {}
      }
      throw Object.assign(new Error(String(message)), { status: response.status, endpoint: url });
    }
    try {
      return JSON.parse(text);
    } catch (_) {
      const html = /^\s*</.test(text) || /<!doctype|<html/i.test(text);
      throw Object.assign(new Error(html
        ? `BluesMinds mengembalikan halaman HTML, bukan respons API JSON (${url})`
        : `Respons BluesMinds bukan JSON yang valid (${url})`), { status: 502, endpoint: url, nonRetryable: true });
    }
  }

  async discoverModels(signal) {
    const data = await this.requestJson(this.endpoint('/models'), { method: 'GET', headers: this.headers(), signal });
    const rows = Array.isArray(data?.data) ? data.data : [];
    return unique(rows.map(item => item?.id || item?.name).filter(Boolean));
  }

  async execute(input, { signal, onProgress = () => {} } = {}) {
    if (input.mediaType && input.mediaType !== 'text') {
      throw Object.assign(new Error('BluesMinds saat ini dikonfigurasi sebagai provider Text AI di AI Ads Lab.'), { status: 409, nonRetryable: true });
    }
    const url = this.endpoint('/chat/completions');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(120000, Number(this.config.timeout_ms) || 0));
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      onProgress('Sending');
      const data = await this.requestJson(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.buildRequest(input)),
        signal: controller.signal
      });
      onProgress('Receiving');
      return this.parseResponse(data);
    } catch (error) {
      error.endpoint ||= url;
      if (controller.signal.aborted && error.name === 'AbortError') {
        throw Object.assign(new Error('BluesMinds belum merespons dalam batas waktu chat'), { status: 504, type: 'Network Error', endpoint: url });
      }
      throw normalizeError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection({ signal } = {}) {
    const started = Date.now();
    const url = this.endpoint('/models');
    try {
      const models = await this.discoverModels(signal);
      if (!models.length) throw Object.assign(new Error('BluesMinds tidak mengembalikan katalog model'), { status: 502, type: 'Provider Error' });
      return {
        connected: true,
        providerVersion: 'OpenAI-compatible API',
        defaultModel: this.selectedModel(),
        responseTime: Date.now() - started,
        models
      };
    } catch (error) {
      const status = Number(error.status || 0);
      const message = String(error.message || '');
      if (status === 401 || status === 403) throw Object.assign(new Error(message || 'API key BluesMinds tidak valid'), { status, type: 'Authentication Error' });
      if (status === 402 || /insufficient|balance|saldo|credit/i.test(message)) throw Object.assign(new Error('Saldo/kredit BluesMinds tidak mencukupi'), { status: status || 402, type: 'Quota Exceeded' });
      if (status === 404) throw Object.assign(new Error(`Endpoint BluesMinds tidak ditemukan: ${url}`), { status, type: 'Provider Error' });
      if (status === 429) throw Object.assign(new Error('Batas penggunaan BluesMinds tercapai'), { status, type: 'Rate Limited' });
      if (!status || error.type === 'Network Error') throw Object.assign(new Error(`Tidak dapat menghubungi BluesMinds (${url})`), { status: 502, type: 'Network Error' });
      throw normalizeError(error);
    }
  }
}

AgentRouterProvider.KNOWN_MODELS = KNOWN_MODELS;
module.exports = AgentRouterProvider;
