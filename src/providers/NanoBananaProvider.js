const BaseProvider = require('./BaseProvider');
const config = require('../config');
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

class NanoBananaProvider extends BaseProvider {
  apiKey() {
    return String(this.config.api_key || '').trim().replace(/^Bearer\s+/i, '');
  }

  headers() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey()}` };
  }

  requestPath() {
    return '/api/v1/nanobanana/generate';
  }

  healthPath() {
    return '/api/v1/common/credit';
  }

  taskPath(taskId) {
    return `/api/v1/nanobanana/record-info?taskId=${encodeURIComponent(taskId)}`;
  }

  imageUrls(input = {}) {
    return (input.assets || []).map(asset => typeof asset === 'string' ? asset : asset?.url).filter(Boolean);
  }

  buildRequest(input = {}) {
    const imageUrls = this.imageUrls(input);
    const body = {
      prompt: input.prompt,
      numImages: 1,
      type: imageUrls.length ? 'IMAGETOIAMGE' : 'TEXTTOIAMGE',
      image_size: input.parameters?.aspectRatio || '1:1',
      callBackUrl: `${config.publicBaseUrl}/api/ai/providers/nanobanana/callback`
    };
    if (imageUrls.length) body.imageUrls = imageUrls;
    return body;
  }

  async responseError(response, payload) {
    let data = payload;
    if (data === undefined) {
      const text = await response.text();
      try { data = JSON.parse(text); } catch { data = text; }
    }
    const message = data?.msg || data?.message || data?.errorMessage || data?.error || (typeof data === 'string' ? data : '') || `HTTP ${response.status}`;
    const status = Number(data?.code || response.status || 500);
    const error = Object.assign(new Error(String(message)), { status });
    if ([401, 403].includes(status)) {
      error.type = 'Authentication Error';
      error.nonRetryable = true;
    }
    if (status === 402) {
      error.type = 'Quota Exceeded';
      error.nonRetryable = true;
    }
    if ([400, 404, 422, 455, 505].includes(status)) error.nonRetryable = true;
    return error;
  }

  async poll(taskId, signal) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await this.transport(this.endpoint(this.taskPath(taskId)), {
          method: 'GET', headers: this.headers(), signal
        });
        const payload = await response.json().catch(async () => ({ msg: await response.text() }));
        if (!response.ok || Number(payload?.code) !== 200) throw await this.responseError(response, payload);
        return payload;
      } catch (error) {
        lastError = error;
        const status = Number(error.status || 0);
        const networkError = error instanceof TypeError || /ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(error.code || '');
        const transient = status === 429 || status >= 500 && status <= 599 || networkError;
        if (!transient || attempt === 3 || error.name === 'AbortError' || signal?.aborted) throw error;
        await delay((Number(this.config.poll_retry_backoff_ms) || 500) * attempt, signal);
      }
    }
    throw lastError;
  }

  async execute(input, { signal, onProgress = () => {} } = {}) {
    let taskId;
    try {
      if (!this.apiKey()) throw Object.assign(new Error('API key NanoBanana belum tersedia'), { status: 422, nonRetryable: true });
      if (input.mediaType && input.mediaType !== 'image') throw Object.assign(new Error('NanoBanana hanya mendukung generate image'), { status: 422, nonRetryable: true });

      onProgress('Sending');
      const submitted = await this.transport(this.endpoint(this.requestPath()), {
        method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal
      });
      const submission = await submitted.json().catch(async () => ({ msg: await submitted.text() }));
      if (!submitted.ok || Number(submission?.code) !== 200) throw await this.responseError(submitted, submission);
      taskId = submission?.data?.taskId || submission?.data?.task_id || submission?.taskId;
      if (!taskId) throw Object.assign(new Error('NanoBanana tidak mengembalikan taskId'), { nonRetryable: true });

      onProgress('Generating');
      while (true) {
        await delay(Number(this.config.poll_interval_ms) || 3000, signal);
        const payload = await this.poll(taskId, signal);
        const data = payload?.data || payload;
        const successFlag = Number(data?.successFlag);
        if (successFlag === 0 || Number.isNaN(successFlag)) {
          onProgress('Waiting');
          continue;
        }
        if ([2, 3].includes(successFlag)) {
          throw Object.assign(new Error(data?.errorMessage || 'NanoBanana generation failed'), {
            status: Number(data?.errorCode) || 500,
            type: 'Provider Error',
            nonRetryable: true
          });
        }
        if (successFlag === 1) {
          const url = data?.response?.resultImageUrl || data?.info?.resultImageUrl || data?.resultImageUrl;
          if (!url) throw Object.assign(new Error('NanoBanana selesai tanpa resultImageUrl'), { nonRetryable: true });
          onProgress('Receiving');
          return {
            content: '',
            media: [{ url }],
            providerJobId: taskId,
            providerRequestId: taskId,
            status: 'completed',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            raw: payload
          };
        }
      }
    } catch (error) {
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
    if (!this.apiKey()) throw Object.assign(new Error('API key NanoBanana belum tersedia'), { status: 422, nonRetryable: true });
    const response = await this.transport(this.endpoint(this.healthPath()), {
      method: 'GET', headers: this.headers(), signal
    });
    const payload = await response.json().catch(async () => ({ msg: await response.text() }));
    if (!response.ok || Number(payload?.code) !== 200) throw await this.responseError(response, payload);
    const credits = Number(payload?.data);
    return {
      connected: true,
      providerVersion: 'NanoBanana API',
      defaultModel: this.config.default_model || 'nanobanana',
      quotaStatus: Number.isFinite(credits) ? `${credits} credits` : 'Available',
      credits: Number.isFinite(credits) ? credits : null,
      responseTime: Date.now() - started
    };
  }
}

module.exports = NanoBananaProvider;
