const API_BASE_URL = 'http://43.159.50.231:20130/v1';
const MASKED_KEY = /[•*]{4,}|\(saved\)/i;

function gatewayUrl(path = '') {
  const suffix = String(path).replace(/^\/+/, '').replace(/^v1\//, '');
  return `${API_BASE_URL}/${suffix}`;
}

class NineRouterClient {
  constructor(config, transport = fetch) {
    this.transport = transport;
    this.timeout = Number(config?.timeout_ms) || 30000;
    this.apiKey = String(config?.api_key || '').trim();
    if (!this.apiKey || MASKED_KEY.test(this.apiKey)) throw Object.assign(new Error('Gateway API key 9Router belum dikonfigurasi'), { status: 422 });
  }

  headers(json = false) {
    return { Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${this.apiKey}` };
  }

  async request(path, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort(options.signal.reason);
    else options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeout);
    try {
      controller.signal.throwIfAborted();
      return await this.transport(gatewayUrl(path), { ...options, headers: { ...this.headers(Boolean(options.body)), ...(options.headers || {}) }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  async responseError(response) {
    const message = (await response.text() || `HTTP ${response.status}`).split(this.apiKey).join('[REDACTED]');
    return Object.assign(new Error(message), { status: response.status });
  }
}

module.exports = { NineRouterClient, API_BASE_URL, gatewayUrl, MASKED_KEY };
