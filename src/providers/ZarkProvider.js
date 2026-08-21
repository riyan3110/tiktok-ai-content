const crypto = require('node:crypto');
const BaseProvider = require('./BaseProvider');
const { normalizeError } = require('../ai/errors');

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));

const unique = values => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];

class ZarkProvider extends BaseProvider {
  headers() {
    return { 'Content-Type': 'application/json', 'X-API-Key': this.config.api_key };
  }

  requestPath() { return '/v1/complete'; }

  model(input = {}) {
    return input.model || (input.mediaType === 'video' ? this.config.video_model : this.config.image_model) || this.config.default_model || 'auto';
  }

  inferDuration(input = {}) {
    const explicit = Number(input.parameters?.duration);
    if (Number.isFinite(explicit) && explicit > 0) return clamp(explicit, 1, 30);
    if (input.mediaType !== 'video') return undefined;

    const prompt = String(input.prompt || '');
    let max = 0;
    for (const match of prompt.matchAll(/(?:^|\s)(\d{1,2}(?:\.\d+)?)\s*(?:-|–|—|to|sampai)\s*(\d{1,2}(?:\.\d+)?)\s*(?:s|sec|detik)\b/gi)) {
      max = Math.max(max, Number(match[2]) || 0);
    }
    for (const match of prompt.matchAll(/(?:^|\s)(\d{1,2}(?:\.\d+)?)\s*(?:s|sec|detik)\b/gi)) {
      max = Math.max(max, Number(match[1]) || 0);
    }
    return max > 0 ? clamp(Math.ceil(max), 1, 30) : undefined;
  }

  aspectRatio(input = {}) {
    const value = input.parameters?.aspectRatio;
    if (value) return value;
    const resolution = String(input.parameters?.resolution || '');
    if (/1080\s*[x×]\s*1920/i.test(resolution)) return '9:16';
    if (/1920\s*[x×]\s*1080/i.test(resolution)) return '16:9';
    if (/1024\s*[x×]\s*1024/i.test(resolution)) return '1:1';
    return '9:16';
  }

  buildRequest(input = {}) {
    if ((input.assets || []).length) {
      throw Object.assign(new Error('Reference asset Zark belum dapat dikirim langsung. Gunakan prompt tanpa reference asset untuk sementara.'), { status: 422, nonRetryable: true });
    }

    const mediaType = input.mediaType === 'video' ? 'video' : 'image';
    const model = this.model(input);
    const duration = this.inferDuration(input);
    const negative = String(input.parameters?.negativePrompt || '').trim();
    const query = negative ? `${input.prompt}\n\nAvoid: ${negative}` : input.prompt;
    const toolParams = {
      action: 'generate',
      model: model || 'auto',
      aspect_ratio: this.aspectRatio(input)
    };
    if (mediaType === 'image') toolParams.num_images = 1;
    if (mediaType === 'video' && duration) toolParams.duration = duration;

    return {
      chat_session_id: `aiads_${crypto.randomUUID()}`,
      query,
      file_ids: [],
      tool: mediaType,
      mode: 'autonomous',
      tool_params: toolParams
    };
  }

  async readEvents(response) {
    const events = [];
    let buffer = '';
    const consume = text => {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try { events.push(JSON.parse(payload)); } catch {}
      }
    };

    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        consume(decoder.decode(value, { stream: true }));
      }
      consume(decoder.decode());
    } else if (response.body?.[Symbol.asyncIterator]) {
      for await (const chunk of response.body) consume(Buffer.from(chunk).toString('utf8'));
    } else {
      consume(await response.text());
    }
    consume('\n');
    return events;
  }

  async readMcpPayload(response) {
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) return response.json();
    const text = await response.text();
    const payloads = text.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean)
      .map(value => { try { return JSON.parse(value); } catch { return null; } })
      .filter(Boolean);
    return payloads.findLast?.(item => item?.result?.tools) || payloads.find(item => item?.result?.tools) || null;
  }

  modelValuesFromSchema(schema, hint = '') {
    const result = { image: new Set(), video: new Set() };
    const visit = (node, path = []) => {
      if (!node || typeof node !== 'object') return;
      const joined = `${hint} ${path.join(' ')}`.toLowerCase();
      const modelPath = path.some(part => /model/i.test(part));
      if (modelPath) {
        const values = [];
        if (Array.isArray(node.enum)) values.push(...node.enum);
        if (typeof node.const === 'string') values.push(node.const);
        if (Array.isArray(node.oneOf)) {
          for (const option of node.oneOf) {
            if (typeof option?.const === 'string') values.push(option.const);
            if (Array.isArray(option?.enum)) values.push(...option.enum);
          }
        }
        const target = /video/.test(joined) ? ['video'] : /image|photo/.test(joined) ? ['image'] : ['image', 'video'];
        for (const type of target) for (const value of values) if (typeof value === 'string') result[type].add(value);
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'enum' || key === 'const') continue;
        visit(value, [...path, key]);
      }
    };
    visit(schema, []);
    return result;
  }

  async discoverModels(signal) {
    const response = await this.transport(this.endpoint('/v1/mcp'), {
      method: 'POST',
      headers: { ...this.headers(), Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `aiads-${Date.now()}`, method: 'tools/list', params: {} }),
      signal
    });
    if (!response.ok) throw Object.assign(new Error(await response.text() || `MCP HTTP ${response.status}`), { status: response.status });
    const payload = await this.readMcpPayload(response);
    const tools = payload?.result?.tools || [];
    const buckets = { image: new Set(['auto']), video: new Set(['auto']) };
    for (const tool of tools) {
      const hint = `${tool?.name || ''} ${tool?.description || ''}`;
      const found = this.modelValuesFromSchema(tool?.inputSchema || tool?.input_schema || {}, hint);
      for (const type of ['image', 'video']) for (const value of found[type]) buckets[type].add(value);
    }
    return { image: unique([...buckets.image]), video: unique([...buckets.video]) };
  }

  async resolveFile(fileId, signal) {
    const response = await this.transport(this.endpoint(`/v1/media/files/${encodeURIComponent(fileId)}`), {
      method: 'GET', headers: this.headers(), signal
    });
    if (!response.ok) throw Object.assign(new Error(await response.text() || `Gagal mengambil hasil Zark (${response.status})`), { status: response.status });

    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.toLowerCase().includes('application/json')) {
      const data = await response.json();
      const source = data.data || data.file || data;
      const url = source.download_url || source.downloadUrl || source.preview_url || source.previewUrl || source.url;
      if (!url) throw new Error(`Zark file ${fileId} tidak memiliki preview/download URL`);
      return { url, fileId, mimeType: source.mime_type || source.mimeType || '' };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error(`Zark file ${fileId} kosong`);
    return { b64_json: bytes.toString('base64'), mime_type: contentType.split(';')[0] || 'application/octet-stream', fileId };
  }

  async execute(input, { signal, onProgress = () => {} } = {}) {
    try {
      onProgress('Sending');
      const response = await this.transport(this.endpoint(this.requestPath()), {
        method: 'POST', headers: this.headers(), body: JSON.stringify(this.buildRequest(input)), signal
      });
      if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status });

      onProgress('Generating');
      const events = await this.readEvents(response);
      const errorEvent = events.find(event => event.type === 'error');
      if (errorEvent) throw Object.assign(new Error(errorEvent.message || errorEvent.error || 'Zark generation failed'), { code: errorEvent.code, status: errorEvent.status });

      const fileIds = [...new Set(events
        .filter(event => ['generation_complete', 'media_item'].includes(event.type) && event.file_id)
        .map(event => event.file_id))];
      if (!fileIds.length) {
        const final = events.findLast?.(event => event.type === 'agent_run_complete') || events.find(event => event.type === 'agent_run_complete');
        for (const id of final?.file_ids || []) if (!fileIds.includes(id)) fileIds.push(id);
      }
      if (!fileIds.length) throw new Error('Zark selesai tanpa file hasil');

      onProgress('Receiving');
      const media = [];
      for (const fileId of fileIds) media.push(await this.resolveFile(fileId, signal));
      const text = events.filter(event => ['ai_chunk', 'ai_complete'].includes(event.type)).map(event => event.content || event.response || '').filter(Boolean).join('');
      const usageEvent = [...events].reverse().find(event => event.type === 'usage') || {};
      return {
        content: text,
        media,
        providerJobId: fileIds[0],
        providerRequestId: events.find(event => event.run_id)?.run_id || null,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, credits: Number(usageEvent.credits || usageEvent.credits_used || 0) || 0 },
        raw: { events, credits: Number(usageEvent.credits || usageEvent.credits_used || 0) || 0 }
      };
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async testConnection({ signal } = {}) {
    const started = Date.now();
    const response = await this.transport(this.endpoint('/v1/storage/files?limit=1'), { method: 'GET', headers: this.headers(), signal });
    if (!response.ok) throw Object.assign(new Error(await response.text() || `HTTP ${response.status}`), { status: response.status });
    let models = { image: ['auto'], video: ['auto'] };
    let modelDiscovery = 'auto-fallback';
    try {
      models = await this.discoverModels(signal);
      modelDiscovery = 'mcp';
    } catch (error) {
      console.warn('[Zark] MCP model discovery unavailable, using auto', error.message);
    }
    return {
      connected: true,
      providerVersion: response.headers?.get?.('x-api-version') || 'Zark API',
      defaultModel: this.config.default_model || 'auto',
      responseTime: Date.now() - started,
      models,
      modelDiscovery
    };
  }
}

module.exports = ZarkProvider;
