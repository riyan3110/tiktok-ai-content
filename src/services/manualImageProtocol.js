'use strict';
const { setTimeout: delay } = require('node:timers/promises');
const protocols = new Set(['openai', 'chat', 'gemini', 'vidu', 'router-images']);
function protocol(value = 'openai') {
  if (!protocols.has(value)) throw Object.assign(new Error('Format Image API tidak didukung.'), { status: 422 });
  return value;
}
function outputSettings(value = '', model = '') {
  const raw = String(value || '').trim();
  if (!raw) return { aspectRatio: null, openAiSize: null, imageSize: null };
  const normalized = raw.toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '');
  const dimensions = normalized.match(/^(\d{2,5})x(\d{2,5})$/);
  let orientation = null;
  if (dimensions) {
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    orientation = width === height ? 'square' : width < height ? 'portrait' : 'landscape';
  } else if (normalized === '1080p' || normalized === '4k') {
    orientation = 'landscape';
  }
  if (!orientation) return { aspectRatio: null, openAiSize: null, imageSize: null };
  const aspectRatio = orientation === 'square' ? '1:1' : orientation === 'portrait' ? '9:16' : '16:9';
  const dalle3 = /dall[._ -]?e[._ -]?3/i.test(String(model || ''));
  const openAiSize = orientation === 'square'
    ? '1024x1024'
    : orientation === 'portrait'
      ? (dalle3 ? '1024x1792' : '1024x1536')
      : (dalle3 ? '1792x1024' : '1536x1024');
  return { aspectRatio, openAiSize, imageSize: normalized === '4k' ? '4K' : null };
}
async function generate({ baseUrl, apiKey, model, format, prompt, images = [], size, signal }, transport) {
  protocol(format);
  const base = baseUrl.replace(/\/+$/, '');
  const output = outputSettings(size, model);
  let endpoint, body, headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  if (format === 'router-images') {
    endpoint = `${base}/images`;
    body = { model, prompt, n: 1, provider: { allow_fallbacks: false }, input_references: images.map(url => ({ type: 'image_url', image_url: { url } })), ...(output.openAiSize ? { size: output.openAiSize } : {}) };
  } else if (format === 'chat') {
    endpoint = `${base}/chat/completions`;
    body = { model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] }], modalities: ['image', 'text'], stream: false, ...(output.aspectRatio ? { image_config: { aspect_ratio: output.aspectRatio, ...(output.imageSize ? { image_size: output.imageSize } : {}) } } : {}) };
  } else if (format === 'gemini') {
    const root = /\/v1(?:beta)?$/.test(base) ? base : `${base}/v1beta`;
    endpoint = `${root}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
    body = { contents: [{ parts: [{ text: prompt }, ...images.map(url => {
      const match = url.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) throw Object.assign(new Error('Referensi Gemini harus berupa gambar yang diunggah.'), { status: 422 });
      return { inlineData: { mimeType: match[1], data: match[2] } };
    })] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(output.aspectRatio ? { imageConfig: { aspectRatio: output.aspectRatio, ...(output.imageSize ? { imageSize: output.imageSize } : {}) } } : {}) } };
  } else if (format === 'vidu') {
    endpoint = `${base.replace(/\/ent\/v2$/, '')}/ent/v2/reference2image`;
    headers.Authorization = `Token ${apiKey}`;
    body = { model, prompt, images, ...(output.aspectRatio ? { aspect_ratio: output.aspectRatio } : {}) };
  } else throw Object.assign(new Error('Gunakan jalur Images API untuk format OpenAI.'), { status: 422 });
  async function send(url, data) {
    const response = await transport(url, { method: data ? 'POST' : 'GET', headers, body: data ? JSON.stringify(data) : undefined, signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error(`Image API menolak request (HTTP ${response.status}). Periksa key, model, format API, dan kuota.`), { status: response.status });
    }
    return response.json();
  }
  let payload = await send(endpoint, body);
  if (format === 'router-images') return { url: payload.data?.[0]?.url || null, b64Json: payload.data?.[0]?.b64_json || null };
  if (format === 'vidu') {
    if (!payload.task_id) throw Object.assign(new Error('Image API tidak mengembalikan task ID.'), { status: 502 });
    const taskUrl = `${base.replace(/\/ent\/v2$/, '')}/ent/v2/tasks/${encodeURIComponent(payload.task_id)}/creations`;
    while (true) {
      payload = await send(taskUrl);
      if (payload.state === 'success') break;
      if (['failed', 'cancelled', 'canceled'].includes(payload.state)) throw Object.assign(new Error('Tugas gambar gagal pada provider.'), { status: 502 });
      await delay(1500, undefined, { signal });
    }
    return { url: payload.creations?.[0]?.url || null, b64Json: null };
  }
  if (format === 'gemini') {
    const part = payload.candidates?.flatMap(candidate => candidate.content?.parts || []).find(item => item.inlineData?.mimeType?.startsWith('image/') || item.inline_data?.mime_type?.startsWith('image/'));
    return { url: null, b64Json: part?.inlineData?.data || part?.inline_data?.data || null };
  }
  const message = payload.choices?.[0]?.message;
  const item = message?.images?.[0] || (Array.isArray(message?.content) ? message.content.find(part => part.type === 'image_url') : null);
  const url = item?.image_url?.url || item?.url || null;
  const match = typeof url === 'string' && url.match(/^data:image\/[^;]+;base64,(.+)$/s);
  return { url: match ? null : url, b64Json: match ? match[1] : null };
}
module.exports = { protocol, outputSettings, generate };
