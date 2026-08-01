const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');

const DEFAULT_MODELS = Object.freeze({ text: 'orcarouter/auto', image: 'openai/gpt-image-1', video: 'kling/kling-v2-6' });
// Keep this allow-list deliberately conservative. Unknown options are omitted rather
// than forwarded to a model which may reject an otherwise valid image request.
const IMAGE_OPTIONS = Object.freeze({
  'openai/gpt-image-1': Object.freeze(['size']),
  'openai/gpt-image-1.5': Object.freeze(['size'])
});
const sanitizedBody = value => String(value || '').replace(/(sk-|Bearer\s+)[\w.-]+/gi, '$1[redacted]').replace(/("b64_json"\s*:\s*")[^"]+/gi, '$1[base64 redacted]').replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, 'data:image/[base64 redacted]').slice(0, 4000);
const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' })); }, { once: true });
});

class OrcaRouterProvider extends BaseProvider {
  endpoint(path = '') { const base = String(this.config.base_url || '').replace(/\/$/, '').replace(/\/v1$/, ''); return `${base}${path}`; }
  model(input = {}) { return input.model || this.config[`${input.mediaType || 'text'}_model`] || DEFAULT_MODELS[input.mediaType || 'text']; }
  requestPath(input = {}) { return input.mediaType === 'image' ? '/v1/images/generations' : input.mediaType === 'video' ? '/v1/video/generations' : '/v1/chat/completions'; }
  buildRequest(input) {
    const model = this.model(input);
    if (input.mediaType === 'image') {
      const body = { model, prompt: input.prompt };
      const allowed = IMAGE_OPTIONS[model] || [];
      const resolution = String(input.parameters?.resolution || '').replace('×', 'x');
      if (allowed.includes('size') && /^\d+x\d+$/.test(resolution)) body.size = resolution;
      return body;
    }
    if (input.mediaType === 'video') return { model, prompt: input.prompt, metadata: { mode: input.metadata?.mode || 'std', aspect_ratio: input.parameters?.aspectRatio || '9:16', duration: String(input.parameters?.duration || '5') } };
    return { model, messages: [{ role: 'user', content: input.prompt }], stream: false };
  }
  parse(data, mediaType = 'text') {
    if (mediaType === 'image') {
      const candidates = [data.data?.[0], data.output?.[0], Array.isArray(data.output) ? null : data.output, data.images?.[0], data.result_url && { url: data.result_url }].filter(Boolean);
      const image = candidates.find(item => typeof item === 'string' || item?.url || item?.b64_json);
      if (!image) throw Object.assign(new Error('Response image kosong'), { type: 'Provider Error', code: 'EMPTY_IMAGE_RESPONSE' });
      const media = [typeof image === 'string' ? { url: image } : image];
      return { ...super.parse({ ...data, images: media }), content: '', status: 'completed' };
    }
    if (mediaType === 'video') return { ...super.parse({ ...data, videos: data.result_url ? [{ url: data.result_url }] : [] }), content: '' };
    const usage = data.usage || {};
    return { content: data.choices?.[0]?.message?.content || '', media: [], providerJobId: data.id || null, status: data.status, usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0 }, raw: data };
  }
  async execute(input, { signal, onProgress = () => {} } = {}) {
    if (input.mediaType !== 'image' && input.mediaType !== 'video') return super.execute(input, { signal, onProgress });
    if (input.mediaType === 'image') {
      const endpoint = this.endpoint(this.requestPath(input)); const model = this.model(input);
      try {
        onProgress('Requesting provider');
        const response = await this.transport(endpoint, { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal });
        const contentType = response.headers.get('content-type') || ''; const requestId = response.headers.get('x-request-id') || response.headers.get('request-id'); const raw = await response.text();
        console.info('[OrcaRouter image]', { endpoint, model, status: response.status, contentType, requestId: requestId || null, response: sanitizedBody(raw) });
        if (!response.ok) { let message = raw || `HTTP ${response.status}`; try { const body = JSON.parse(raw); message = body.error?.message || body.message || body.detail || message; } catch {} throw Object.assign(new Error(message), { status: response.status, code: `HTTP_${response.status}`, providerRequestId: requestId, endpoint }); }
        let payload; try { payload = JSON.parse(raw); } catch { throw Object.assign(new Error(`Response provider bukan JSON (${contentType || 'tanpa content-type'})`), { code: 'INVALID_PROVIDER_RESPONSE', providerRequestId: requestId, endpoint }); }
        onProgress('Provider completed'); const result = this.parse(payload, input.mediaType); result.providerRequestId = requestId; result.endpoint = endpoint; return result;
      } catch (error) { const normalized = normalizeError(error); Object.assign(normalized, { code: error.code, providerRequestId: error.providerRequestId, endpoint }); throw normalized; }
    }
    try {
      onProgress('Sending');
      const submitted = await this.transport(this.endpoint(this.requestPath(input)), { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal });
      if (!submitted.ok) throw Object.assign(new Error(await submitted.text() || `HTTP ${submitted.status}`), { status: submitted.status });
      const submission = await submitted.json(); const taskId = submission.task_id || submission.id || submission.data?.task_id;
      if (!taskId) throw new Error('OrcaRouter tidak mengembalikan task_id');
      onProgress('Generating');
      while (true) {
        await delay(Number(this.config.video_poll_interval_ms) || 5000, signal);
        const response = await this.transport(this.endpoint(`/v1/video/generations/${encodeURIComponent(taskId)}`), { headers: this.headers(), signal });
        if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status });
        const payload = await response.json(); const data = payload.data || payload; const status = String(data.status || '').toUpperCase();
        if (status === 'FAILURE') throw Object.assign(new Error(data.fail_reason || 'Video generation failed'), { type: 'Provider Error' });
        if (status === 'SUCCESS') { onProgress('Receiving'); return this.parse({ ...data, task_id: taskId }, 'video'); }
        onProgress(status === 'SUBMITTED' ? 'Waiting' : 'Generating');
      }
    } catch (error) { throw normalizeError(error); }
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

OrcaRouterProvider.DEFAULT_MODELS = DEFAULT_MODELS;
OrcaRouterProvider.IMAGE_OPTIONS = IMAGE_OPTIONS;
module.exports = OrcaRouterProvider;
