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
  headers() { return { 'Content-Type': 'application/json', Authorization: `Token ${this.config.api_key}` }; }

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
    const body = {
      model: input.model || this.config.video_model || this.config.default_model || 'viduq3-turbo',
      prompt: input.prompt,
      duration: parameters.duration,
      seed: parameters.seed,
      aspect_ratio: parameters.aspectRatio,
      resolution: parameters.resolution
    };
    const images = this.images(input);
    const path = this.requestPath(input);
    if (path === '/ent/v2/img2video' && images.length > 1) throw new Error('Vidu img2video hanya menerima satu gambar');
    if (path === '/ent/v2/reference2video' && images.length > 7) throw new Error('Vidu reference2video hanya menerima maksimal tujuh gambar');
    if (images.length) body.images = images;
    return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
  }

  async execute(input, { signal, onProgress = () => {} } = {}) {
    let taskId;
    try {
      onProgress('Sending');
      const submitted = await this.transport(this.endpoint(this.requestPath(input)), {
        method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal
      });
      if (!submitted.ok) throw Object.assign(new Error(await submitted.text() || `HTTP ${submitted.status}`), { status: submitted.status });
      const submission = await submitted.json();
      taskId = submission.task_id || submission.id || submission.data?.task_id;
      if (!taskId) throw new Error('Vidu tidak mengembalikan task_id');

      onProgress('Generating');
      while (true) {
        await delay(Number(this.config.video_poll_interval_ms) || 5000, signal);
        const response = await this.transport(this.endpoint(`/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`), {
          method: 'GET', headers: this.headers(), signal
        });
        if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status });
        const payload = await response.json();
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
      const normalized = normalizeError(error);
      if (taskId) normalized.nonRetryable = true;
      throw normalized;
    }
  }

  async testConnection({ signal } = {}) {
    const started = Date.now();
    const response = await this.transport(this.endpoint('/ent/v2/tasks'), { method: 'GET', headers: this.headers(), signal });
    if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status });
    return { connected: true, providerVersion: response.headers?.get?.('x-api-version') || 'Available', defaultModel: this.config.video_model || this.config.default_model || 'viduq3-turbo', responseTime: Date.now() - started };
  }
}

module.exports = ViduProvider;
