const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../config');

const PATCHED = Symbol.for('aiads.tiktokPullResilience');
const MAX_PULL_RETRIES = 2;
const RETRY_DELAYS_MS = [1500, 4000];

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function invalidImageUrl(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function withPullToken(url, token, index) {
  const parsed = new URL(url);
  parsed.searchParams.set('_tiktok_pull', `${token}-${index}`);
  return parsed.toString();
}

function freshUrls(imageUrls, attempt) {
  const token = `${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 8)}`;
  return imageUrls.map((url, index) => withPullToken(url, token, index));
}

async function validateGeneratedFileLocally(imageUrl, verifiedPrefix) {
  let url;
  let prefix;
  try {
    url = new URL(imageUrl);
    prefix = new URL(verifiedPrefix.endsWith('/') ? verifiedPrefix : `${verifiedPrefix}/`);
  } catch {
    throw invalidImageUrl(`URL gambar tidak valid: ${imageUrl}`);
  }

  if (url.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname)) {
    throw invalidImageUrl(`URL gambar harus memakai prefix domain yang sudah diverifikasi: ${prefix}`);
  }

  if (!url.pathname.startsWith('/generated/')) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw invalidImageUrl(`URL gambar tidak valid: ${imageUrl}`);
  }

  const publicRoot = path.resolve(config.root, 'public');
  const localPath = path.resolve(publicRoot, decodedPath.replace(/^\/+/, ''));
  if (!localPath.startsWith(`${publicRoot}${path.sep}`)) {
    throw invalidImageUrl(`Path gambar tidak valid: ${imageUrl}`);
  }

  let stat;
  try {
    stat = await fs.stat(localPath);
  } catch {
    throw invalidImageUrl(`File gambar tidak ditemukan: ${imageUrl}`);
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw invalidImageUrl(`File gambar kosong atau tidak valid: ${imageUrl}`);
  }

  const handle = await fs.open(localPath, 'r');
  try {
    const header = Buffer.alloc(3);
    const { bytesRead } = await handle.read(header, 0, 3, 0);
    if (bytesRead < 3 || header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) {
      throw invalidImageUrl(`File gambar harus JPEG yang valid: ${imageUrl}`);
    }
  } finally {
    await handle.close();
  }

  return stat.size;
}

function install({ tiktok } = {}) {
  if (!tiktok?.publishPhotos || !tiktok?.status || !tiktok?.validateImageUrls) {
    throw new Error('TikTok pull resilience patch membutuhkan TikTok service.');
  }
  if (tiktok[PATCHED]) return;

  const originalPublishPhotos = tiktok.publishPhotos.bind(tiktok);
  const originalStatus = tiktok.status.bind(tiktok);
  const originalValidateImageUrls = tiktok.validateImageUrls.bind(tiktok);
  const originalCancel = typeof tiktok.cancel === 'function' ? tiktok.cancel.bind(tiktok) : null;
  const contexts = new Map();
  const aliases = new Map();

  tiktok.validateImageUrls = async (imageUrls, verifiedPrefix) => {
    const localResults = await Promise.all(
      imageUrls.map(url => validateGeneratedFileLocally(url, verifiedPrefix))
    );

    if (localResults.every(value => value !== null)) return localResults;
    return originalValidateImageUrls(imageUrls, verifiedPrefix);
  };

  tiktok.publishPhotos = async (accessToken, imageUrls, caption) => {
    const sourceUrls = [...imageUrls];
    const result = await originalPublishPhotos(accessToken, freshUrls(sourceUrls, 0), caption);
    const publishId = result?.data?.publish_id;
    if (publishId) contexts.set(publishId, { accessToken, imageUrls: sourceUrls, caption, retries: 0 });
    return result;
  };

  tiktok.status = async (accessToken, publishId) => {
    const rootId = String(publishId || '');
    const activeId = aliases.get(rootId) || rootId;
    const result = await originalStatus(accessToken, activeId);
    const data = result?.data || {};
    const context = contexts.get(rootId);

    if (data.status === 'FAILED' && data.fail_reason === 'photo_pull_failed' && context && context.retries < MAX_PULL_RETRIES) {
      context.retries += 1;
      await sleep(RETRY_DELAYS_MS[context.retries - 1] || 1500);
      const retryResult = await originalPublishPhotos(
        context.accessToken || accessToken,
        freshUrls(context.imageUrls, context.retries),
        context.caption
      );
      const retryId = retryResult?.data?.publish_id;
      if (retryId) {
        aliases.set(rootId, retryId);
        console.warn('[TikTok Pull] photo_pull_failed, retry otomatis', {
          attempt: context.retries,
          from: activeId,
          to: retryId
        });
        return {
          data: {
            status: 'PROCESSING_DOWNLOAD',
            fail_reason: null,
            downloaded_bytes: null,
            retry_attempt: context.retries
          },
          error: { code: 'ok', message: '' }
        };
      }
    }

    if (data.status === 'SEND_TO_USER_INBOX' || data.status === 'PUBLISH_COMPLETE') {
      contexts.delete(rootId);
      aliases.delete(rootId);
    }
    return result;
  };

  if (originalCancel) {
    tiktok.cancel = (accessToken, publishId) => originalCancel(accessToken, aliases.get(String(publishId || '')) || publishId);
  }

  Object.defineProperty(tiktok, PATCHED, { value: true });
}

module.exports = { install, MAX_PULL_RETRIES };
