const crypto = require('node:crypto');
const config = require('../config');
const API = 'https://open.tiktokapis.com';
const STATE_TTL_MS = 15 * 60 * 1000;
const STATUS_RETRY_DELAYS_MS = [500, 1500];

function randomState(redirectUri = config.tiktokRedirectUri) {
  // TikTok expects an opaque, URL-safe state value. Keep the callback URI and
  // expiry in the server-side oauth_states row instead of encoding them here;
  // punctuation-heavy signed payloads are rejected by some Login Kit clients.
  return crypto.randomBytes(32).toString('hex');
}

function verifyState(state) {
  return /^[a-f0-9]{64}$/.test(String(state || ''));
}

function authorizationUrl(state, redirectUri = config.tiktokRedirectUri) {
  const p = new URLSearchParams({ client_key: config.tiktokClientKey, scope: 'user.info.basic,video.upload', response_type: 'code', redirect_uri: redirectUri, state });
  return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
}
function requestError(response, body) {
  const error = new Error(body.error_description || body.error?.message || `TikTok HTTP ${response.status}`);
  error.httpStatus = response.status;
  error.tiktokCode = body.error?.code || null;
  return error;
}
async function request(url, options) {
  const response = await fetch(url, options); const body = await response.json();
  if (!response.ok || (body.error?.code && body.error.code !== 'ok')) throw requestError(response, body);
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
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function retryableStatusError(error) {
  return Number(error?.httpStatus) === 429 || Number(error?.httpStatus) >= 500 || error?.tiktokCode === 'internal_error' || error?.tiktokCode === 'rate_limit_exceeded';
}
async function status(accessToken, publishId) {
  let lastError;
  for (let attempt = 0; attempt <= STATUS_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await request(`${API}/v2/post/publish/status/fetch/`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ publish_id: publishId }) });
    } catch (error) {
      lastError = error;
      if (!retryableStatusError(error) || attempt >= STATUS_RETRY_DELAYS_MS.length) throw error;
      await sleep(STATUS_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}
async function validateAccessToken(accessToken) {
  const result = await request(`${API}/v2/user/info/?fields=open_id,display_name`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const user = result.data?.user;
  return user?.open_id ? { openId: user.open_id, displayName: user.display_name || user.open_id } : null;
}
async function validateImageUrl(imageUrl, prefix) {
  let url;
  try { url = new URL(imageUrl); } catch { throw invalidImageUrl(`URL gambar tidak valid: ${imageUrl}`); }
  if (url.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname)) {
    throw invalidImageUrl(`URL gambar harus memakai prefix domain yang sudah diverifikasi: ${prefix}`);
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
  return bytes;
}
async function validateImageUrls(imageUrls, verifiedPrefix) {
  const prefix = new URL(verifiedPrefix.endsWith('/') ? verifiedPrefix : `${verifiedPrefix}/`);
  // Validate all carousel slides concurrently so the preflight does not add one
  // full public-URL round trip per image before TikTok can begin its own pull.
  return Promise.all(imageUrls.map(imageUrl => validateImageUrl(imageUrl, prefix)));
}
function invalidImageUrl(message) { return Object.assign(new Error(message), { status: 400 }); }
module.exports = { authorizationUrl, exchangeCode, refresh, publishPhotos, status, validateAccessToken, validateImageUrls, randomState, verifyState, STATE_TTL_MS, STATUS_RETRY_DELAYS_MS };
