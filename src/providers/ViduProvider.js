const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');

const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
  const cleanup = () => signal?.removeEventListener('abort', onAbort);
  const onAbort = () => {
    clearTimeout(timer);
    cleanup();
    reject(signal.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
  };
  const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
  signal?.addEventListener('abort', onAbort, { once: true });
});

class ViduProvider extends BaseProvider {
  apiKey() {
    return String(this.config.api_key || '').trim().replace(/^(?:Token|Bearer)\s+/i, '');
  }

  headers() {
    return { 'Content-Type': 'application/json', Authorization: `Token ${this.apiKey()}` };
  }

  async responseError(response) {
    const text = await response.text();
    let message = text || `HTTP ${response.status}`;
    try {
      const payload = JSON.parse(text);
      message = payload?.message || payload?.error?.message || payload?.error || message;
    } catch (_) {}
    if (response.status === 401 || response.status === 403) {
      return Object.assign(new Error(`Vidu menolak API key (${response.status}). Simpan ulang API key Vidu lalu coba lagi.`), {
        status: response.status,
        type: 'Authentication Error',
        nonRetryable: true
      });
    }
    return Object.assign(new Error(String(message)), { status: response.status });
  }

  model(input = {}) {
    if (input.mediaType === 'image') {
      if (['viduq2', 'viduq1'].includes(input.model)) return input.model;
      return ['viduq2', 'viduq1'].includes(this.config.image_model) ? this.config.image_model : 'viduq2';
    }
    return [input.model, this.config.video_model, this.config.default_model].find(model => model && model !== 'vidu2.0') || 'viduq3-turbo';
  }

  images(input = {}) {
    return (input.assets || []).map(asset => {
      if (typeof asset === 'string') return asset;
      if (asset?.url) return asset.url;
      if (asset?.data) return `data:${asset.mimeType || asset.mime_type || 'image/png'};base64,${asset.data}`;
      return null;
    }).filter(Boolean);
  }

  requestPath(input = {}) {
    if (input.mediaType === 'image') return '/ent/v2/reference2image';
    const count = this.images(input).length;
    if (count === 0) return '/ent/v2/text2video';
    if (count === 1) return '/ent/v2/img2video';
    return '/ent/v2/reference2video';
  }

  buildRequest(input) {
    const parameters = input.parameters || {};
    const path = this.requestPath(input);
    const body = {
      model: this.model(input),
      prompt: input.prompt,
      duration: parameters.duration,
      seed: parameters.seed,
      ...(path === '/ent/v2/img2video' ? {} : { aspect_ratio: parameters.aspectRatio }),
      resolution: parameters.resolution
    };
    const images = this.images(input);
    if (input.mediaType === 'image' && images.length > 7) throw new Error('Vidu reference2image hanya menerima maksimal tujuh gambar');
    if (path === '/ent/v2/img2video' && images.length > 1) throw new Error('Vidu img2video hanya menerima satu gambar');
    if (path === '/ent/v2/reference2video' && images.length > 7) throw new Error('Vidu reference2video hanya menerima maksimal tujuh gambar');
    if (images.length) body.images = images;
    return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
  }

  async poll(taskId, signal) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await this.transport(this.endpoint(`/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`), {
          method: 'GET', headers: this.headers(), signal
        });
        if (!response.ok) throw await this.responseError(response);
        return await response.json();
      } catch (error) {
        lastError = error;
        const status = Number(error.status || 0);
        const networkError = error instanceof TypeError || /ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(error.code || '');
        const transient = status === 429 || status >= 500 && status <= 599 || networkError;
        if (!transient || attempt === 3 || error.name === 'AbortError' || signal?.aborted) throw error;
        await delay((Number(this.config.poll_retry_backoff_ms) || 250) * attempt, signal);
      }
    }
    throw lastError;
  }

  async cancelTask(taskId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(this.config.cancel_timeout_ms) || 2000);
    try {
      await this.transport(this.endpoint(`/ent/v2/tasks/${encodeURIComponent(taskId)}/cancel`), {
        method: 'POST', headers: this.headers(), body: JSON.stringify({ id: taskId }), signal: controller.signal
      });
    } catch {}
    finally { clearTimeout(timeout); }
  }

  async execute(input, { signal, onProgress = () => {} } = {}) {
    let taskId;
    try {
      if (!this.apiKey()) throw Object.assign(new Error('API key Vidu belum tersedia'), { status: 422, nonRetryable: true });
      onProgress('Sending');
      const submitted = await this.transport(this.endpoint(this.requestPath(input)), {
        method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal
      });
      if (!submitted.ok) throw await this.responseError(submitted);
      const submission = await submitted.json();
      taskId = submission.task_id || submission.id || submission.data?.task_id;
      if (!taskId) throw new Error('Vidu tidak mengembalikan task_id');

      onProgress('Generating');
      while (true) {
        await delay(Number(this.config.video_poll_interval_ms) || 5000, signal);
        const payload = await this.poll(taskId, signal);
        const data = payload.data || payload;
        const status = String(data.state || data.status || '').toLowerCase();
        if (['failed', 'failure'].includes(status)) throw Object.assign(new Error(data.err_code || data.message || 'Video generation failed'), { type: 'Provider Error' });
        if (['success', 'succeeded', 'completed'].includes(status)) {
          const videos = (data.creations || []).filter(creation => creation?.url);
          if (!videos.length) throw new Error('Vidu berhasil tanpa URL creation');
          onProgress('Receiving');
          return this.parse({ ...data, task_id: taskId, videos });
        }
        onProgress(['created', 'queueing', 'queued'].includes(status) ? 'Waiting' : 'Generating');
      }
    } catch (error) {
      if (taskId && signal?.aborted) await this.cancelTask(taskId);
      const normalized = normalizeError(error);
      if (taskId) {
        normalized.nonRetryable = true;
        normalized.providerRequestId = taskId;
      }
      throw normalized;
    }
  }

  async testConnection({ signal } = {}) {
    const started = Date.now();
    if (!this.apiKey()) throw Object.assign(new Error('API key Vidu belum tersedia'), { status: 422, nonRetryable: true });
    const response = await this.transport(this.endpoint('/ent/v2/tasks'), { method: 'GET', headers: this.headers(), signal });
    if (!response.ok) throw await this.responseError(response);
    return { connected: true, providerVersion: response.headers?.get?.('x-api-version') || 'Available', defaultModel: this.model({ mediaType: 'video' }), responseTime: Date.now() - started };
  }
}

module.exports = ViduProvider;
