const crypto = require('node:crypto');
const config = require('../config');
const API = 'https://open.tiktokapis.com';
const STATE_TTL_MS = 15 * 60 * 1000;

function randomState(redirectUri = config.tiktokRedirectUri) {
  const payload = Buffer.from(JSON.stringify({
    nonce: crypto.randomBytes(24).toString('hex'),
    expiresAt: Date.now() + STATE_TTL_MS,
    redirectUri: redirectUri || null
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyState(state) {
  const [payload, signature, extra] = String(state || '').split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest();
  let received;
  try { received = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.nonce || !Number.isFinite(data.expiresAt) || data.expiresAt < Date.now()) return null;
    return data;
  } catch { return null; }
}

function authorizationUrl(state, redirectUri = config.tiktokRedirectUri) {
  const p = new URLSearchParams({ client_key: config.tiktokClientKey, scope: 'user.info.basic,video.upload', response_type: 'code', redirect_uri: redirectUri, state });
  return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
}
async function request(url, options) {
  const response = await fetch(url, options); const body = await response.json();
  if (!response.ok || (body.error?.code && body.error.code !== 'ok')) throw new Error(body.error_description || body.error?.message || `TikTok HTTP ${response.status}`);
  return body;
}
async function exchangeCode(code, redirectUri = config.tiktokRedirectUri) {
  const body = new URLSearchParams({ client_key: config.tiktokClientKey, client_secret: config.tiktokClientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  return request(`${API}/v2/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}
async function refresh(refreshToken) {
  const body = new URLSearchParams({ client_key: config.tiktokClientKey, client_secret: config.tiktokClientSecret, grant_type: 'refresh_token', refresh_token: refreshToken });
  return request(`${API}/v2/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}
async function publishPhotos(accessToken, imageUrls, caption) {
  return request(`${API}/v2/post/publish/content/init/`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ post_info: { title: caption.slice(0, 90), description: caption.slice(0, 2200) }, source_info: { source: 'PULL_FROM_URL', photo_images: imageUrls, photo_cover_index: 0 }, post_mode: 'MEDIA_UPLOAD', media_type: 'PHOTO' }) });
}
async function status(accessToken, publishId) {
  return request(`${API}/v2/post/publish/status/fetch/`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ publish_id: publishId }) });
}
async function validateImageUrls(imageUrls, verifiedPrefix) {
  const prefix = new URL(verifiedPrefix.endsWith('/') ? verifiedPrefix : `${verifiedPrefix}/`);
  for (const imageUrl of imageUrls) {
    let url;
    try { url = new URL(imageUrl); } catch { throw invalidImageUrl(`URL gambar tidak valid: ${imageUrl}`); }
    if (url.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname)) {
      throw invalidImageUrl(`URL gambar harus memakai prefix domain yang sudah diverifikasi: ${verifiedPrefix}`);
    }
    let response;
    try { response = await fetch(url, { method: 'GET', redirect: 'manual' }); } catch {
      throw invalidImageUrl(`URL gambar tidak dapat diakses: ${imageUrl}`);
    }
    if (response.status >= 300 && response.status < 400) throw invalidImageUrl(`URL gambar tidak boleh redirect: ${imageUrl}`);
    if (response.status !== 200) throw invalidImageUrl(`URL gambar harus merespons HTTP 200: ${imageUrl}`);
    if ((response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'image/jpeg') {
      throw invalidImageUrl(`Content-Type URL gambar harus image/jpeg: ${imageUrl}`);
    }
    const bytes = (await response.arrayBuffer()).byteLength;
    if (bytes === 0) throw invalidImageUrl(`Ukuran file gambar tidak boleh 0: ${imageUrl}`);
  }
}
function invalidImageUrl(message) { return Object.assign(new Error(message), { status: 400 }); }
module.exports = { authorizationUrl, exchangeCode, refresh, publishPhotos, status, validateImageUrls, randomState, verifyState, STATE_TTL_MS };
