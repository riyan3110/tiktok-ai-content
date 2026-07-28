const crypto = require('node:crypto');
const config = require('../config');
const API = 'https://open.tiktokapis.com';

function authorizationUrl(state) {
  const p = new URLSearchParams({ client_key: config.tiktokClientKey, scope: 'user.info.basic,video.publish,video.upload', response_type: 'code', redirect_uri: config.tiktokRedirectUri, state });
  return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
}
async function request(url, options) {
  const response = await fetch(url, options); const body = await response.json();
  if (!response.ok || (body.error?.code && body.error.code !== 'ok')) throw new Error(body.error_description || body.error?.message || `TikTok HTTP ${response.status}`);
  return body;
}
async function exchangeCode(code) {
  const body = new URLSearchParams({ client_key: config.tiktokClientKey, client_secret: config.tiktokClientSecret, code, grant_type: 'authorization_code', redirect_uri: config.tiktokRedirectUri });
  return request(`${API}/v2/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}
async function refresh(refreshToken) {
  const body = new URLSearchParams({ client_key: config.tiktokClientKey, client_secret: config.tiktokClientSecret, grant_type: 'refresh_token', refresh_token: refreshToken });
  return request(`${API}/v2/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}
async function publishPhotos(accessToken, imageUrls, caption) {
  return request(`${API}/v2/post/publish/content/init/`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ post_info: { title: caption.slice(0, 90), description: caption.slice(0, 2200), disable_comment: false, privacy_level: 'SELF_ONLY', auto_add_music: true }, source_info: { source: 'PULL_FROM_URL', photo_images: imageUrls, photo_cover_index: 0 }, post_mode: 'DIRECT_POST', media_type: 'PHOTO' }) });
}
async function status(accessToken, publishId) {
  return request(`${API}/v2/post/publish/status/fetch/`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ publish_id: publishId }) });
}
module.exports = { authorizationUrl, exchangeCode, refresh, publishPhotos, status, randomState: () => crypto.randomBytes(24).toString('hex') };
