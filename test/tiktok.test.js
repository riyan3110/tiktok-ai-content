const test = require('node:test');
const assert = require('node:assert/strict');
const tiktok = require('../src/services/tiktok');

test('OAuth state ditandatangani, menyimpan redirect URI, dan menolak perubahan', () => {
  const state = tiktok.randomState('https://app.example.com/auth/tiktok/callback');
  assert.equal(tiktok.verifyState(state).redirectUri, 'https://app.example.com/auth/tiktok/callback');
  assert.equal(tiktok.verifyState(`${state.slice(0, -1)}x`), null);
});

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

  await tiktok.publishPhotos('access-token', ['https://example.com/slide.jpg'], 'Caption');

  const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://open.tiktokapis.com/v2/post/publish/content/init/');
  assert.equal(body.post_mode, 'MEDIA_UPLOAD');
  assert.equal(body.media_type, 'PHOTO');
  assert.deepEqual(body.source_info.photo_images, ['https://example.com/slide.jpg']);
  assert.equal(body.source_info.source, 'PULL_FROM_URL');
  assert.equal(body.post_info.privacy_level, undefined);
});

test('status memakai endpoint publish status fetch dengan publish_id', async (t) => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } }) }; };
  t.after(() => { global.fetch = originalFetch; });
  await tiktok.status('access-token', 'draft-1');
  assert.equal(request.url, 'https://open.tiktokapis.com/v2/post/publish/status/fetch/');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { publish_id: 'draft-1' });
});

test('validasi URL gambar mensyaratkan 200, JPEG, tanpa redirect, dan isi tidak kosong', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ status: 200, headers: new Headers({ 'Content-Type': 'image/jpeg' }), arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
  t.after(() => { global.fetch = originalFetch; });
  await tiktok.validateImageUrls(['https://cdn.example.com/generated/1.jpg'], 'https://cdn.example.com/generated/');
});

test('validasi URL gambar menolak redirect dan domain di luar prefix terverifikasi', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ status: 302, headers: new Headers({ location: '/other.jpg' }), arrayBuffer: async () => new ArrayBuffer(1) });
  t.after(() => { global.fetch = originalFetch; });
  await assert.rejects(() => tiktok.validateImageUrls(['https://cdn.example.com/generated/1.jpg'], 'https://cdn.example.com/generated/'), /tidak boleh redirect/);
  await assert.rejects(() => tiktok.validateImageUrls(['https://cdn.example.com.evil.test/generated/1.jpg'], 'https://cdn.example.com/generated/'), /prefix domain/);
});
