const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');

const DEFAULT_MODELS = Object.freeze({ text: 'orcarouter/auto', image: 'openai/gpt-image-1', video: 'kling/kling-v2-6' });
const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' })); }, { once: true });
});

class OrcaRouterProvider extends BaseProvider {
  model(input = {}) { return input.model || this.config[`${input.mediaType || 'text'}_model`] || DEFAULT_MODELS[input.mediaType || 'text']; }
  requestPath(input = {}) { return input.mediaType === 'image' ? '/v1/images/generations' : input.mediaType === 'video' ? '/v1/video/generations' : '/v1/chat/completions'; }
  buildRequest(input) {
    const model = this.model(input);
    if (input.mediaType === 'image') return { model, prompt: input.prompt, size: input.parameters?.resolution || '1024x1024' };
    if (input.mediaType === 'video') return { model, prompt: input.prompt, metadata: { mode: input.metadata?.mode || 'std', aspect_ratio: input.parameters?.aspectRatio || '9:16', duration: String(input.parameters?.duration || '5') } };
    return { model, messages: [{ role: 'user', content: input.prompt }], stream: false };
  }
  parse(data, mediaType = 'text') {
    if (mediaType === 'image') {
      const images = (data.data || data.images || []).map(item => typeof item === 'string' ? { url: item } : item);
      return { ...super.parse({ ...data, images }), content: '', status: 'completed' };
    }
    if (mediaType === 'video') return { ...super.parse({ ...data, videos: data.result_url ? [{ url: data.result_url }] : [] }), content: '' };
    const usage = data.usage || {};
    return { content: data.choices?.[0]?.message?.content || '', media: [], providerJobId: data.id || null, status: data.status, usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0 }, raw: data };
  }
  async execute(input, { signal, onProgress = () => {} } = {}) {
    if (input.mediaType !== 'video') {
      try { onProgress('Sending'); const response = await this.transport(this.endpoint(this.requestPath(input)), { method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal }); if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status }); onProgress('Receiving'); return this.parse(await response.json(), input.mediaType); } catch (error) { throw normalizeError(error); }
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
module.exports = OrcaRouterProvider;
