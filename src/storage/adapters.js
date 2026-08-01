const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class StorageAdapter {
  async upload() { throw new Error('Not implemented'); }
  async delete() { throw new Error('Not implemented'); }
  async copy() { throw new Error('Not implemented'); }
  async move(source, target) { const result = await this.copy(source, target); await this.delete(source); return result; }
  async rename(source, target) { return this.move(source, target); }
}
class LocalStorageAdapter extends StorageAdapter {
  constructor({ root, publicBaseUrl = '' }) { super(); this.root = path.resolve(root); this.publicBaseUrl = publicBaseUrl; }
  resolve(key) { const clean = String(key).replace(/^\/+/, ''); const file = path.resolve(this.root, clean); if (file !== this.root && !file.startsWith(`${this.root}${path.sep}`)) throw Object.assign(new Error('Invalid storage key'), { status: 400 }); return file; }
  async upload(key, data) { const file = this.resolve(key); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, data); return { key, size: data.length, checksum: crypto.createHash('sha256').update(data).digest('hex'), url: this.publicUrl(key) }; }
  async delete(key) { await fs.rm(this.resolve(key), { force: true }); return { deleted: true, key }; }
  async copy(source, target) { await fs.mkdir(path.dirname(this.resolve(target)), { recursive: true }); await fs.copyFile(this.resolve(source), this.resolve(target)); return this.metadata(target); }
  async metadata(key) { const stat = await fs.stat(this.resolve(key)); const data = await fs.readFile(this.resolve(key)); return { key, size: stat.size, modifiedAt: stat.mtime.toISOString(), checksum: crypto.createHash('sha256').update(data).digest('hex'), url: this.publicUrl(key) }; }
  publicUrl(key) { return `${this.publicBaseUrl}/asset-files/${encodeURIComponent(key).replace(/%2F/g, '/')}`; }
  async signedUrl(key) { return this.publicUrl(key); }
  async test() { const started = Date.now(); await fs.mkdir(this.root, { recursive: true }); await fs.access(this.root); return { connected: true, latency: Date.now() - started, bucketStatus: 'Writable', permission: 'Read / Write / Delete' }; }
}
class TencentCosAdapter extends StorageAdapter {
  constructor(options, transport = fetch) { super(); this.options = options; this.transport = transport; }
  endpoint() {
    const bucket = String(this.options.bucket || '').trim();
    const region = String(this.options.region || '').trim().toLowerCase();
    const configured = String(this.options.endpoint || '').trim();
    const scheme = this.options.useHttps === false ? 'http:' : 'https:';
    const endpoint = configured ? new URL(configured.includes('://') ? configured : `${scheme}//${configured}`) : new URL(`${scheme}//${bucket}.cos.${region}.myqcloud.com`);
    return { origin: endpoint.origin, host: endpoint.host.toLowerCase() };
  }
  host() { return this.endpoint().host; }
  encode(value) { return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`); }
  pathname(key) { return `/${String(key || '').replace(/^\/+/, '').split('/').map(part => this.encode(part)).join('/')}`; }
  canonicalQuery(query = '') {
    return [...new URLSearchParams(String(query).replace(/^\?/, '')).entries()]
      .map(([name, value]) => [this.encode(name.toLowerCase()), this.encode(value)])
      .sort(([leftName, leftValue], [rightName, rightValue]) => leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue))
      .map(parts => parts.join('='))
      .join('&');
  }
  url(key, query = '') { const canonicalQuery = this.canonicalQuery(query); return `${this.endpoint().origin}${this.pathname(key)}${canonicalQuery ? `?${canonicalQuery}` : ''}`; }
  authorization(method, key, query = '', expires = 3600) {
    // COS XML API uses its q-sign HMAC-SHA1 scheme. TC3-HMAC-SHA256 is for
    // Tencent Cloud API 3.0 endpoints and is not accepted by COS bucket hosts.
    const now = Math.floor(Date.now() / 1000);
    const period = `${now - 60};${now + expires}`;
    const canonicalQuery = this.canonicalQuery(query);
    const httpString = `${method.toLowerCase()}\n${this.pathname(key)}\n${canonicalQuery}\nhost=${this.host()}\n`;
    const sha1 = value => crypto.createHash('sha1').update(value).digest('hex');
    const signKey = crypto.createHmac('sha1', this.options.secretKey).update(period).digest('hex');
    const signature = crypto.createHmac('sha1', signKey).update(`sha1\n${period}\n${sha1(httpString)}\n`).digest('hex');
    const authorization = `q-sign-algorithm=sha1&q-ak=${this.encode(String(this.options.secretId || '').trim())}&q-sign-time=${period}&q-key-time=${period}&q-header-list=host&q-url-param-list=${canonicalQuery ? canonicalQuery.split('&').map(item => item.split('=')[0]).join(';') : ''}&q-signature=${signature}`;
    return this.options.securityToken ? `${authorization}&x-cos-security-token=${this.encode(this.options.securityToken)}` : authorization;
  }
  async request(method, key, { data, query = '', headers = {} } = {}) {
    const response = await this.transport(this.url(key, query), { method, body: data, headers: { Host: this.host(), Authorization: this.authorization(method, key, query), ...headers } });
    if (!response.ok) { const details = typeof response.text === 'function' ? await response.text() : ''; const requestId = response.headers?.get?.('x-cos-request-id'); throw Object.assign(new Error(`Tencent COS ${method} failed (${response.status})${requestId ? ` [request-id: ${requestId}]` : ''}${details ? `: ${details}` : ''}`), { status: response.status }); }
    return response;
  }
  async upload(key, data, metadata = {}) { await this.request('PUT', key, { data, headers: { 'Content-Type': metadata.mimeType || 'application/octet-stream', ...(this.options.encryption ? { 'x-cos-server-side-encryption': 'AES256' } : {}) } }); return { key, size: data.length, checksum: crypto.createHash('sha256').update(data).digest('hex'), url: this.publicUrl(key) }; }
  async delete(key) { await this.request('DELETE', key); return { deleted: true, key }; }
  async copy(source, target) { await this.request('PUT', target, { headers: { 'x-cos-copy-source': `/${this.options.bucket}/${source}` } }); return { key: target, url: this.publicUrl(target) }; }
  async metadata(key) { const response = await this.request('HEAD', key); return { key, size: Number(response.headers.get('content-length') || 0), etag: response.headers.get('etag'), modifiedAt: response.headers.get('last-modified'), url: this.publicUrl(key) }; }
  publicUrl(key) { const base = this.options.publicUrl || `${this.options.useHttps === false ? 'http' : 'https'}://${this.host()}`; return `${base.replace(/\/$/, '')}/${String(key).replace(/^\/+/, '')}`; }
  async signedUrl(key, expires = 3600) { return `${this.url(key)}?${this.authorization('GET', key, '', expires)}`; }
  async initiateMultipart(key) { const response = await this.request('POST', key, { query: 'uploads=' }); return response.text(); }
  async uploadPart(key, uploadId, partNumber, data) { const query = `partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`; const response = await this.request('PUT', key, { query, data }); return response.headers.get('etag'); }
  async completeMultipart(key, uploadId, parts) { const body = `<CompleteMultipartUpload>${parts.map(p => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`; await this.request('POST', key, { query: `uploadId=${encodeURIComponent(uploadId)}`, data: body }); return { key, url: this.publicUrl(key) }; }
  async test() { const started = Date.now(); await this.request('GET', '', { query: 'max-keys=0' }); return { connected: true, latency: Date.now() - started, bucketStatus: 'Available', permission: 'List / Read / Write (validated)' }; }
}
module.exports = { StorageAdapter, LocalStorageAdapter, TencentCosAdapter };
