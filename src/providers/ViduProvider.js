const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');

const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(signal.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError' }));
  }, { once: true });
});

class ViduProvider extends BaseProvider {
  headers() { return { 'Content-Type': 'application/json', Authorization: `Token ${this.config.api_key}` }; }

  imageUrls(input = {}) {
    return (input.assets || []).map(asset => typeof asset === 'string' ? asset : asset?.url).filter(Boolean);
  }

  requestPath(input = {}) { return this.imageUrls(input).length ? '/ent/v2/img2video' : '/ent/v2/text2video'; }

  buildRequest(input) {
    const parameters = input.parameters || {};
    const body = {
      model: input.model || this.config.default_model,
      prompt: input.prompt,
      duration: parameters.duration,
      seed: parameters.seed,
      aspect_ratio: parameters.aspectRatio,
      resolution: parameters.resolution
    };
    const images = this.imageUrls(input);
    if (images.length) body.images = images;
    return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
  }

  async execute(input, { signal, onProgress = () => {} } = {}) {
    try {
      onProgress('Sending');
      const submitted = await this.transport(this.endpoint(this.requestPath(input)), {
        method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal
      });
      if (!submitted.ok) throw Object.assign(new Error(await submitted.text() || `HTTP ${submitted.status}`), { status: submitted.status });
      const submission = await submitted.json();
      const taskId = submission.task_id || submission.id || submission.data?.task_id;
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
          onProgress('Receiving');
          return this.parse({ ...data, task_id: taskId, videos: data.creations || [] });
        }
        onProgress(['created', 'queueing', 'queued'].includes(status) ? 'Waiting' : 'Generating');
      }
    } catch (error) {
      throw normalizeError(error);
    }
  }
}

module.exports = ViduProvider;
