const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { encrypt, decrypt } = require('./credentials');
const { LocalStorageAdapter, TencentCosAdapter } = require('./adapters');
const { AssetRepository } = require('./repository');

const MIME_BY_EXTENSION = Object.freeze({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.json': 'application/json'
});

function detectMimeType(buffer, name = '', supplied = '') {
  const hex = buffer.subarray(0, 16).toString('hex');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return 'image/gif';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.subarray(4, 12).toString().includes('ftypavif')) return 'image/avif';
  if (hex.startsWith('25504446')) return 'application/pdf';
  const declared = String(supplied || '').toLowerCase().split(';')[0].trim();
  if (declared && declared !== 'application/octet-stream') return declared;
  return MIME_BY_EXTENSION[path.extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

class StorageService {
  constructor({ db, transport } = {}) { this.db = db; this.transport = transport; this.repository = new AssetRepository(db); this.uploads = new Map(); }
  row() { return this.db.prepare("SELECT * FROM storage_settings WHERE id=1").get(); }
  publicSettings() { const row = this.row(); return { provider: row.provider, secretId: row.secret_id_encrypted ? '••••••••' : '', secretKey: row.secret_key_encrypted ? '••••••••' : '', hasSecretId: Boolean(row.secret_id_encrypted), hasSecretKey: Boolean(row.secret_key_encrypted), bucket: row.bucket, region: row.region, endpoint: row.endpoint, useHttps: Boolean(row.use_https), signedUrlExpiration: row.signed_url_expiration, publicUrl: row.public_url, encryption: Boolean(row.encryption), storageQuota: row.storage_quota, autoDeleteDays: row.auto_delete_days, retentionDays: row.retention_days, versioning: Boolean(row.versioning), duplicateDetection: Boolean(row.duplicate_detection) }; }
  saveSettings(body) { const old = this.row(); const secretId = body.secretId === undefined || body.secretId === '••••••••' ? old.secret_id_encrypted : encrypt(body.secretId); const secretKey = body.secretKey === undefined || body.secretKey === '••••••••' ? old.secret_key_encrypted : encrypt(body.secretKey); if (!['local', 'tencent-cos'].includes(body.provider || old.provider)) throw Object.assign(new Error('Storage provider tidak didukung'), { status: 422 }); this.db.prepare(`UPDATE storage_settings SET provider=?,secret_id_encrypted=?,secret_key_encrypted=?,bucket=?,region=?,endpoint=?,use_https=?,signed_url_expiration=?,public_url=?,encryption=?,storage_quota=?,auto_delete_days=?,retention_days=?,versioning=?,duplicate_detection=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(body.provider ?? old.provider, secretId, secretKey, body.bucket ?? old.bucket, body.region ?? old.region, body.endpoint ?? old.endpoint, Number(body.useHttps ?? old.use_https), Math.max(60, Number(body.signedUrlExpiration ?? old.signed_url_expiration)), body.publicUrl ?? old.public_url, Number(body.encryption ?? old.encryption), Math.max(0, Number(body.storageQuota ?? old.storage_quota)), Math.max(0, Number(body.autoDeleteDays ?? old.auto_delete_days)), Math.max(0, Number(body.retentionDays ?? old.retention_days)), Number(body.versioning ?? old.versioning), Number(body.duplicateDetection ?? old.duplicate_detection)); return this.publicSettings(); }
  local() { return new LocalStorageAdapter({ root: path.join(config.root, 'data/assets'), publicBaseUrl: config.publicBaseUrl }); }
  adapter(provider = this.row().provider) { if (provider === 'local') return this.local(); const row = this.row(); return new TencentCosAdapter({ secretId: decrypt(row.secret_id_encrypted), secretKey: decrypt(row.secret_key_encrypted), bucket: row.bucket, region: row.region, endpoint: row.endpoint, useHttps: Boolean(row.use_https), publicUrl: row.public_url, encryption: Boolean(row.encryption) }, this.transport); }
  async test() { const settings = this.publicSettings(); const result = await this.adapter().test(); const usage = this.db.prepare('SELECT COALESCE(SUM(size),0) usage FROM assets WHERE deleted_at IS NULL').get().usage; return { ...result, storageUsage: usage, quota: settings.storageQuota }; }
  async upload(input) {
    const buffer = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data || '', 'base64');
    if (!buffer.length) throw Object.assign(new Error('File kosong'), { status: 422 });
    const row = this.row(); const provider = row.provider;
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const lockKey = `${provider}:${checksum}`;
    if (row.duplicate_detection && this.uploads.has(lockKey)) return { ...await this.uploads.get(lockKey), duplicate: true };
    const operation = this.performUpload(input, buffer, checksum, row);
    if (row.duplicate_detection) this.uploads.set(lockKey, operation);
    try { return await operation; } finally { if (this.uploads.get(lockKey) === operation) this.uploads.delete(lockKey); }
  }
  async performUpload({ name, mimeType, type, folderId, tags = [], metadata = {}, generated = false }, buffer, checksum, row) {
    const provider = row.provider;
    if (row.duplicate_detection) { const duplicate = this.repository.findDuplicate(checksum, provider); if (duplicate) return { ...duplicate, duplicate: true }; }
    const used = this.db.prepare('SELECT COALESCE(SUM(size),0) usage FROM assets WHERE deleted_at IS NULL').get().usage;
    if (row.storage_quota && used + buffer.length > row.storage_quota) throw Object.assign(new Error('Storage quota terlampaui'), { status: 413 });
    const detectedMimeType = detectMimeType(buffer, name, mimeType);
    const extension = path.extname(name).replace(/[^.a-zA-Z0-9]/g, '');
    const requestedKey = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`;
    const adapter = this.adapter(provider);
    const stored = await adapter.upload(requestedKey, buffer, { mimeType: detectedMimeType });
    const key = stored.key || requestedKey; const url = stored.url || adapter.publicUrl(key);
    try { return this.repository.create({ id: crypto.randomUUID(), name, type: type || this.inferType(detectedMimeType), mimeType: detectedMimeType, storageProvider: provider, storageKey: key, storageUrl: url, folderId: folderId || null, size: buffer.length, checksum: stored.checksum || checksum, tags: JSON.stringify(tags), metadata: JSON.stringify(metadata), isGenerated: Number(generated) }); }
    catch (error) { await adapter.delete(key).catch(() => {}); throw error; }
  }
  inferType(mime = '') { return mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'prompt-attachment'; }
  async url(asset) { return this.adapter(asset.storage_provider).signedUrl(asset.storage_key, this.row().signed_url_expiration); }
  assetMimeType(asset) { return detectMimeType(Buffer.alloc(0), asset.name || asset.storage_key, asset.mime_type); }
  async accessible(asset) { const url = await this.url(asset); const image = asset.type === 'image' || this.assetMimeType(asset).startsWith('image/'); return { ...asset, mime_type: this.assetMimeType(asset), type: image ? 'image' : asset.type, storage_url: url, url, preview_url: image ? `/api/assets/${encodeURIComponent(asset.id)}/preview` : null }; }
  async preview(asset) { const downloaded = await this.adapter(asset.storage_provider).download(asset.storage_key); return { data: downloaded.data, mimeType: detectMimeType(downloaded.data, asset.name || asset.storage_key, downloaded.contentType || asset.mime_type) }; }
  async accessibleList(query = {}) { return Promise.all(this.repository.list(query).map(asset => this.accessible(asset))); }
  async move(id, patch) { const asset = this.repository.get(id); if (!asset) throw Object.assign(new Error('Asset tidak ditemukan'), { status: 404 }); if (patch.name && patch.name !== asset.name) { const target = `${path.dirname(asset.storage_key)}/${crypto.randomUUID()}${path.extname(patch.name)}`; const adapter = this.adapter(asset.storage_provider); const stored = await adapter.rename(asset.storage_key, target); patch.storageKey = stored.key || target; patch.storageUrl = stored.url || adapter.publicUrl(target); } return this.repository.update(id, patch); }
  async copy(id) { const asset = this.repository.get(id); if (!asset) throw Object.assign(new Error('Asset tidak ditemukan'), { status: 404 }); const key = `${path.dirname(asset.storage_key)}/${crypto.randomUUID()}${path.extname(asset.storage_key)}`; const adapter = this.adapter(asset.storage_provider); const stored = await adapter.copy(asset.storage_key, key); return this.repository.create({ id: crypto.randomUUID(), name: `Copy of ${asset.name}`, type: asset.type, mimeType: asset.mime_type, storageProvider: asset.storage_provider, storageKey: stored.key || key, storageUrl: stored.url || adapter.publicUrl(key), folderId: asset.folder_id, size: asset.size, checksum: asset.checksum, tags: JSON.stringify(asset.tags), metadata: JSON.stringify({ ...asset.metadata, copiedFrom: asset.id }), isGenerated: Number(asset.is_generated) }); }
}
module.exports = { StorageService, detectMimeType };
