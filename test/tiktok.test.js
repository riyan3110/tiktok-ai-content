const test = require('node:test');
const assert = require('node:assert/strict');
const tiktok = require('../src/services/tiktok');

test('authorization URL hanya meminta scope sandbox yang aktif', () => {
  const url = new URL(tiktok.authorizationUrl('oauth-state'));

  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.upload');
  assert.equal(url.searchParams.get('state'), 'oauth-state');
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('upload foto membuat draft dengan MEDIA_UPLOAD, bukan Direct Post', async (t) => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ data: { publish_id: 'draft-1' }, error: { code: 'ok' } }) };
  };
  t.after(() => { global.fetch = originalFetch; });

  await tiktok.publishPhotos('access-token', ['https://example.com/slide.png'], 'Caption');

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://open.tiktokapis.com/v2/post/publish/content/init/');
  assert.equal(body.post_mode, 'MEDIA_UPLOAD');
  assert.equal(body.media_type, 'PHOTO');
  assert.equal(body.post_info.privacy_level, undefined);
});
