const PATCHED = Symbol.for('aiads.tiktokPullResilience');
const MAX_PULL_RETRIES = 2;
const RETRY_DELAYS_MS = [1500, 4000];

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function withPullToken(url, token, index) {
  const parsed = new URL(url);
  parsed.searchParams.set('_tiktok_pull', `${token}-${index}`);
  return parsed.toString();
}

function freshUrls(imageUrls, attempt) {
  const token = `${Date.now()}-${attempt}-${Math.random().toString(36).slice(2, 8)}`;
  return imageUrls.map((url, index) => withPullToken(url, token, index));
}

function install({ tiktok } = {}) {
  if (!tiktok?.publishPhotos || !tiktok?.status) throw new Error('TikTok pull resilience patch membutuhkan TikTok service.');
  if (tiktok[PATCHED]) return;

  const originalPublishPhotos = tiktok.publishPhotos.bind(tiktok);
  const originalStatus = tiktok.status.bind(tiktok);
  const originalCancel = typeof tiktok.cancel === 'function' ? tiktok.cancel.bind(tiktok) : null;
  const contexts = new Map();
  const aliases = new Map();

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
