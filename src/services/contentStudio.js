const path = require('node:path');

const connector = require('../ai/connector');
const PROVIDER_NAMES = Object.freeze({ 'google-flow': 'Google Flow', 'google-veo': 'Google Veo', 'google-imagen': 'Google Imagen', 'google-gemini': 'Google Gemini', 'openai-images': 'OpenAI Images', vidu: 'Vidu', omni: 'Omni' });

const decodeDataUrl = value => {
  const match = String(value || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  return { mimeType: match[1] || 'application/octet-stream', data: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])) };
};

class ContentStudioService {
  constructor({ db, storage, fetcher = fetch } = {}) { this.db = db; this.storage = storage; this.fetcher = fetcher; }
  providers() { const rows = connector.configuredProviders(this.db); return rows.map(row => ({ id: row.provider, name: PROVIDER_NAMES[row.provider], types: connector.CAPABILITIES[row.provider], isDefault: Boolean(row.is_default) })); }
  list(query = {}) {
    const rows = this.db.prepare('SELECT * FROM ai_generations ORDER BY created_at DESC LIMIT 500').all();
    const search = String(query.search || '').trim().toLowerCase(); const type = String(query.type || ''); const status = String(query.status || ''); const provider = String(query.provider || '');
    return rows.map(row => this.serialize(row)).filter(item => (!search || `${item.prompt} ${item.provider} ${item.model}`.toLowerCase().includes(search)) && (!type || item.media_type === type) && (!status || item.status === status) && (!provider || item.provider === provider));
  }
  get(id) { const row = this.db.prepare('SELECT * FROM ai_generations WHERE id=?').get(id); return row ? this.serialize(row) : null; }
  serialize(row) { const metadata = JSON.parse(row.metadata || '{}'); const media = JSON.parse(row.media || '[]'); const status = ['Queued', 'Completed', 'Failed', 'Cancelled'].includes(row.status) ? row.status : 'Running'; return { ...row, status, provider_status: row.status, assets: JSON.parse(row.assets || '[]'), media, metadata, negative_prompt: metadata.negativePrompt || '', resolution: metadata.resolution || '', progress: this.progress(row.status), asset_id: metadata.generatedAssetId || null, file_size: metadata.fileSize || 0, result_url: metadata.resultUrl || media[0]?.url || '' }; }
  progress(status) { return ({ Queued: 0, Preparing: 8, Uploading: 20, Generating: 45, Waiting: 55, Receiving: 75, Downloading: 82, Rendering: 92, Completed: 100, Failed: 100, Cancelled: 100 })[status] ?? 35; }
  createQueued(id, body) {
    const prompt = String(body.prompt || '').trim(); if (!prompt) throw Object.assign(new Error('Prompt wajib diisi'), { status: 422 });
    const mediaType = body.mediaType === 'video' ? 'video' : 'image'; const count = Math.max(1, Math.min(10, Number(body.count) || 1));
    const metadata = { ...(body.metadata || {}), negativePrompt: String(body.negativePrompt || ''), resolution: String(body.resolution || (mediaType === 'video' ? '1080p' : '1024×1024')), source: body.promptSource === 'generator' ? 'Prompt Generator' : 'Manual', batchCount: count };
    this.db.prepare("INSERT INTO ai_generations(id,provider,model,prompt,status,media_type,assets,metadata,request_time,prompt_size) VALUES(?,?,?,?,'Queued',?,?,?,?,?)").run(id, body.provider, body.model || null, prompt, mediaType, JSON.stringify(body.assets || []), JSON.stringify(metadata), new Date().toISOString(), Buffer.byteLength(prompt));
    return { count, metadata };
  }
  async persistResult(id) {
    const item = this.get(id); if (!item || item.status !== 'Completed' || !item.media.length) return item;
    const source = item.media[0]; let payload = decodeDataUrl(source.b64_json ? `data:${source.mime_type || ''};base64,${source.b64_json}` : source.url);
    if (!payload && source.url) { const response = await this.fetcher(source.url); if (!response.ok) throw new Error(`Gagal mengambil hasil provider (${response.status})`); payload = { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get('content-type') || '' }; }
    if (!payload) return item;
    const extension = payload.mimeType.includes('video') ? '.mp4' : payload.mimeType.includes('png') ? '.png' : '.jpg';
    const asset = await this.storage.upload({ name: `content-studio-${id}${extension}`, mimeType: payload.mimeType, type: item.media_type, data: payload.data, generated: true, tags: ['content-studio', item.provider], metadata: { generationId: id, prompt: item.prompt } });
    const accessible = await this.storage.accessible(asset); const metadata = { ...item.metadata, generatedAssetId: asset.id, fileSize: asset.size, resultUrl: accessible.url };
    this.db.prepare('UPDATE ai_generations SET metadata=?,media=?,output_size=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(metadata), JSON.stringify([{ url: accessible.url, assetId: asset.id, mimeType: asset.mime_type }]), asset.size, id);
    return this.get(id);
  }
  async remove(id) { const item = this.get(id); if (!item) return false; if (item.asset_id) { const asset = this.storage.repository.get(item.asset_id); if (asset) { await this.storage.adapter(asset.storage_provider).delete(asset.storage_key); this.storage.repository.remove(asset.id); } } return this.db.prepare('DELETE FROM ai_generations WHERE id=?').run(id).changes > 0; }
  async download(id) { const item = this.get(id); if (!item?.asset_id) return null; const asset = this.storage.repository.get(item.asset_id); if (!asset) return null; const file = await this.storage.preview(asset); return { ...file, name: path.basename(asset.name) }; }
}

module.exports = { ContentStudioService, PROVIDER_NAMES };
