const path = require('node:path');

const connector = require('../ai/connector');
const PROVIDER_NAMES = Object.freeze({ '9router': '9Router', orcarouter: 'OrcaRouter', 'google-flow': 'Google Flow', 'google-veo': 'Google Veo', 'google-imagen': 'Google Imagen', 'google-gemini': 'Google Gemini', 'openai-images': 'OpenAI Images', vidu: 'Vidu', omni: 'Omni' });

const decodeDataUrl = value => {
  const match = String(value || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  return { mimeType: match[1] || 'application/octet-stream', data: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])) };
};
const imageMime = data => data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : data.subarray(0, 3).equals(Buffer.from([255,216,255])) ? 'image/jpeg' : data.subarray(0, 6).toString('ascii').startsWith('GIF8') ? 'image/gif' : data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : '';

class ContentStudioService {
  constructor({ db, storage, fetcher = fetch } = {}) { this.db = db; this.storage = storage; this.fetcher = fetcher; }
  providers() { const rows = connector.configuredProviders(this.db); return rows.map(row => ({ id: row.provider, name: PROVIDER_NAMES[row.provider], types: connector.CAPABILITIES[row.provider], defaultCapabilities: connector.defaultCapabilities(this.db, row.provider), models: { text: row.text_model || row.default_model, image: row.image_model || row.default_model, video: row.video_model || row.default_model } })); }
  generatedAssetIndex() {
    const index = new Map();
    for (const asset of this.storage.repository.list()) {
      const generationId = String(asset.metadata?.generationId || '');
      if (asset.is_generated && generationId && !index.has(generationId)) index.set(generationId, asset);
    }
    return index;
  }
  previewUrl(assetId) { return `/api/assets/${encodeURIComponent(assetId)}/preview`; }
  resolveResultAsset(row, metadata, media, generatedByJob = this.generatedAssetIndex()) {
    const candidates = [metadata.generatedAssetId, media[0]?.assetId].filter(Boolean).map(String);
    for (const id of candidates) {
      const asset = this.storage.repository.get(id);
      if (asset && !asset.deleted_at) return asset;
    }
    return generatedByJob.get(String(row.id)) || null;
  }
  linkResultAsset(row, metadata, media, asset) {
    if (!asset) return { metadata, media };
    const stableImageUrl = row.media_type === 'image' ? this.previewUrl(asset.id) : '';
    const resultUrl = stableImageUrl || metadata.resultUrl || media[0]?.url || asset.storage_url || '';
    const nextMetadata = { ...metadata, generatedAssetId: asset.id, fileSize: metadata.fileSize || asset.size, resultUrl };
    const firstMedia = { ...(media[0] || {}), url: resultUrl, assetId: asset.id, mimeType: media[0]?.mimeType || asset.mime_type };
    const nextMedia = media.length ? [firstMedia, ...media.slice(1)] : [firstMedia];
    const needsBackfill = metadata.generatedAssetId !== asset.id || metadata.resultUrl !== resultUrl || media[0]?.assetId !== asset.id || media[0]?.url !== resultUrl;
    if (needsBackfill) this.db.prepare('UPDATE ai_generations SET metadata=?,media=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(nextMetadata), JSON.stringify(nextMedia), row.id);
    return { metadata: nextMetadata, media: nextMedia };
  }
  list(query = {}) {
    const rows = this.db.prepare('SELECT * FROM ai_generations ORDER BY created_at DESC LIMIT 500').all();
    const generatedByJob = this.generatedAssetIndex();
    const search = String(query.search || '').trim().toLowerCase(); const type = String(query.type || ''); const status = String(query.status || ''); const provider = String(query.provider || '');
    return rows.map(row => this.serialize(row, generatedByJob)).filter(item => (!search || `${item.prompt} ${item.provider} ${item.model}`.toLowerCase().includes(search)) && (!type || item.media_type === type) && (!status || item.status === status) && (!provider || item.provider === provider));
  }
  get(id) { const row = this.db.prepare('SELECT * FROM ai_generations WHERE id=?').get(id); return row ? this.serialize(row, this.generatedAssetIndex()) : null; }
  serialize(row, generatedByJob) {
    let metadata = JSON.parse(row.metadata || '{}'); let media = JSON.parse(row.media || '[]');
    const asset = this.resolveResultAsset(row, metadata, media, generatedByJob);
    ({ metadata, media } = this.linkResultAsset(row, metadata, media, asset));
    const status = ['Queued', 'Completed', 'Failed', 'Cancelled'].includes(row.status) ? row.status : 'Running';
    const resultMissing = row.status === 'Completed' && !asset;
    const resultUrl = resultMissing ? '' : (row.media_type === 'image' && asset ? this.previewUrl(asset.id) : metadata.resultUrl || media[0]?.url || '');
    return { ...row, status, provider_stage: row.status, assets: JSON.parse(row.assets || '[]'), media, metadata, negative_prompt: metadata.negativePrompt || '', resolution: metadata.resolution || '', progress: this.progress(row.status), asset_id: asset?.id || null, file_size: metadata.fileSize || asset?.size || 0, result_url: resultUrl, result_missing: resultMissing, error_type: resultMissing ? (row.error_type || 'ResultAssetMissing') : row.error_type, error_code: resultMissing ? (row.error_code || 'RESULT_ASSET_MISSING') : row.error_code, error_message: resultMissing ? (row.error_message || 'File hasil tidak ditemukan di Asset Manager.') : row.error_message };
  }
  progress(status) { return ({ Queued: 0, Preparing: 8, 'Requesting provider': 30, 'Provider completed': 65, 'Downloading media': 75, 'Uploading to COS': 90, Uploading: 20, Generating: 45, Waiting: 55, Receiving: 75, Downloading: 82, Rendering: 92, Completed: 100, Failed: 100, Cancelled: 100 })[status] ?? 35; }
  createQueued(id, body) {
    const prompt = String(body.prompt || '').trim(); if (!prompt) throw Object.assign(new Error('Prompt wajib diisi'), { status: 422 });
    const mediaType = body.mediaType === 'video' ? 'video' : 'image'; const count = Math.max(1, Math.min(10, Number(body.count) || 1));
    const metadata = { ...(body.metadata || {}), modelType: body.modelType || null, capability: body.capability || mediaType, negativePrompt: String(body.negativePrompt || ''), resolution: String(body.resolution || (mediaType === 'video' ? '1080p' : '1024×1024')), source: body.promptSource === 'generator' ? 'Prompt Generator' : 'Manual', batchCount: count };
    this.db.prepare("INSERT INTO ai_generations(id,provider,model,prompt,status,media_type,assets,metadata,request_time,prompt_size) VALUES(?,?,?,?,'Queued',?,?,?,?,?)").run(id, body.provider, body.model || null, prompt, mediaType, JSON.stringify(body.assets || []), JSON.stringify(metadata), new Date().toISOString(), Buffer.byteLength(prompt));
    return { count, metadata };
  }
  async persistResult(id) {
    const item = this.get(id); if (!item || item.status !== 'Completed' || !item.media.length) return item;
    const orcaImage = item.provider === 'orcarouter' && item.media_type === 'image';
    if (orcaImage) this.db.prepare("UPDATE ai_generations SET status='Downloading media',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    const source = item.media[0]; let payload = decodeDataUrl(source.b64_json ? `data:${source.mime_type || 'image/png'};base64,${source.b64_json}` : source.url);
    if (!payload && source.url) { const response = await this.fetcher(source.url); if (!response.ok) throw Object.assign(new Error(orcaImage ? `Download hasil gagal (${response.status})` : `Gagal mengambil hasil provider (${response.status})`), { code: orcaImage ? 'MEDIA_DOWNLOAD_FAILED' : undefined }); const contentType = response.headers.get('content-type') || ''; if (orcaImage && !contentType.toLowerCase().startsWith('image/')) throw Object.assign(new Error(`Download hasil bukan image (${contentType || 'tanpa content-type'})`), { code: 'INVALID_IMAGE_CONTENT_TYPE' }); payload = { data: Buffer.from(await response.arrayBuffer()), mimeType: contentType.split(';')[0] }; }
    if (!payload?.data?.length) { if (orcaImage) throw Object.assign(new Error('Response image kosong'), { code: 'EMPTY_IMAGE_RESPONSE' }); return item; }
    if (orcaImage) { const detected = imageMime(payload.data); if (!detected) throw Object.assign(new Error('Data hasil bukan image yang valid'), { code: 'INVALID_IMAGE_DATA' }); payload.mimeType = detected; }
    const extension = payload.mimeType.includes('video') ? '.mp4' : payload.mimeType.includes('png') ? '.png' : '.jpg';
    if (orcaImage) this.db.prepare("UPDATE ai_generations SET status='Uploading to COS',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    let asset; try { asset = await this.storage.upload({ name: `content-studio-${id}${extension}`, mimeType: payload.mimeType, type: item.media_type, data: payload.data, generated: true, tags: ['content-studio', item.provider], metadata: { generationId: id, prompt: item.prompt } }); } catch (error) { if (orcaImage) throw Object.assign(new Error(`Upload Tencent COS gagal: ${error.message}`), { code: 'COS_UPLOAD_FAILED', cause: error }); throw error; }
    const resultUrl = item.media_type === 'image' ? this.previewUrl(asset.id) : (await this.storage.accessible(asset)).url;
    const metadata = { ...item.metadata, generatedAssetId: asset.id, fileSize: asset.size, resultUrl };
    this.db.prepare("UPDATE ai_generations SET status='Completed',metadata=?,media=?,output_size=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(metadata), JSON.stringify([{ url: resultUrl, assetId: asset.id, mimeType: asset.mime_type }]), asset.size, id);
    return this.get(id);
  }
  async remove(id) { const item = this.get(id); if (!item) return false; if (item.asset_id) { const asset = this.storage.repository.get(item.asset_id); if (asset) { await this.storage.adapter(asset.storage_provider).delete(asset.storage_key); this.storage.repository.remove(asset.id); } } return this.db.prepare('DELETE FROM ai_generations WHERE id=?').run(id).changes > 0; }
  async download(id) { const item = this.get(id); if (!item?.asset_id) return null; const asset = this.storage.repository.get(item.asset_id); if (!asset) return null; const file = await this.storage.preview(asset); return { ...file, name: path.basename(asset.name) }; }
}

module.exports = { ContentStudioService, PROVIDER_NAMES };
