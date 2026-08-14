const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tiktok = require('../src/services/tiktok');
const cancelPatch = require('../src/services/tiktokCancelPatch');

function connectTimeoutError() {
  const error = new TypeError('fetch failed');
  error.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
  return error;
}

test('TikTok status check retries transient API failure without retrying forever', async t => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  let calls = 0;
  global.setTimeout = fn => { fn(); return 1; };
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: { code: 'internal_error', message: 'temporary' } })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { status: 'PROCESSING_DOWNLOAD' }, error: { code: 'ok' } })
    };
  };
  t.after(() => { global.fetch = originalFetch; global.setTimeout = originalSetTimeout; });

  const result = await tiktok.status('access-token', 'publish-1');
  assert.equal(result.data.status, 'PROCESSING_DOWNLOAD');
  assert.equal(calls, 2);
});

test('TikTok status retries a transient Undici connect timeout', async t => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  let calls = 0;
  global.setTimeout = fn => { fn(); return 1; };
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw connectTimeoutError();
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { status: 'PROCESSING_DOWNLOAD' }, error: { code: 'ok' } })
    };
  };
  t.after(() => { global.fetch = originalFetch; global.setTimeout = originalSetTimeout; });

  const result = await tiktok.status('access-token', 'publish-network');
  assert.equal(result.data.status, 'PROCESSING_DOWNLOAD');
  assert.equal(calls, 2);
});

test('carousel URL preflight starts all slide checks concurrently', async t => {
  const originalFetch = global.fetch;
  let started = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  global.fetch = async () => {
    started += 1;
    if (started === 2) release();
    await gate;
    return {
      status: 200,
      headers: new Headers({ 'Content-Type': 'image/jpeg' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    };
  };
  t.after(() => { global.fetch = originalFetch; });

  const sizes = await tiktok.validateImageUrls([
    'https://cdn.example.com/generated/1.jpg',
    'https://cdn.example.com/generated/2.jpg'
  ], 'https://cdn.example.com/generated/');

  assert.equal(started, 2);
  assert.deepEqual(sizes, [3, 3]);
});

test('TikTok cancel uses the publish cancel endpoint with the current user token', async t => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ error: { code: 'ok', message: '' } })
    };
  };
  t.after(() => { global.fetch = originalFetch; });

  await tiktok.cancel('access-token', 'publish-123');

  assert.equal(request.url, 'https://open.tiktokapis.com/v2/post/publish/cancel/');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer access-token');
  assert.deepEqual(JSON.parse(request.options.body), { publish_id: 'publish-123' });
});

test('TikTok cancel retries a transient Undici connect timeout', async t => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  let calls = 0;
  global.setTimeout = fn => { fn(); return 1; };
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw connectTimeoutError();
    return {
      ok: true,
      status: 200,
      json: async () => ({ error: { code: 'ok', message: '' } })
    };
  };
  t.after(() => { global.fetch = originalFetch; global.setTimeout = originalSetTimeout; });

  await tiktok.cancel('access-token', 'publish-timeout');
  assert.equal(calls, 2);
});

test('publish init is never automatically replayed after an ambiguous network failure', async t => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw connectTimeoutError();
  };
  t.after(() => { global.fetch = originalFetch; });

  await assert.rejects(
    () => tiktok.publishPhotos('access-token', ['https://cdn.example.com/generated/1.jpg'], 'Caption'),
    /fetch failed/
  );
  assert.equal(calls, 1);
});

test('accepted cancellation is attached only to a known pending AI Ads Lab publish id', async () => {
  let marked = false;
  let cancelArgs;
  const future = Date.now() + 10 * 60 * 1000;
  const db = {
    prepare(sql) {
      return {
        get(value) {
          if (sql.includes('FROM contents WHERE publish_id')) return value === 'publish-1' ? { id: 7, publish_status: 'PROCESSING_DOWNLOAD' } : undefined;
          if (sql.includes("FROM oauth_tokens WHERE provider='tiktok'")) return { access_token: 'token-1', refresh_token: 'refresh-1', expires_at: future };
          return undefined;
        },
        run(value) {
          if (sql.includes("publish_status='CANCEL_REQUESTED'")) {
            marked = value === 'publish-1';
            return { changes: 1 };
          }
          return { changes: 1 };
        }
      };
    }
  };
  const fakeTikTok = {
    cancel: async (token, publishId) => { cancelArgs = [token, publishId]; return { error: { code: 'ok' } }; }
  };

  const result = await cancelPatch.cancelPendingPublish({ db, tiktok: fakeTikTok, publishId: 'publish-1' });

  assert.deepEqual(cancelArgs, ['token-1', 'publish-1']);
  assert.equal(marked, true);
  assert.deepEqual(result, { cancelled: true, status: 'CANCEL_REQUESTED', publishId: 'publish-1' });
});

test('browser polling does not turn five minutes of PROCESSING_DOWNLOAD into a false failure', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/background-state.js'), 'utf8');
  assert.match(source, /URL_PULL_WINDOW_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(source, /data\.status === 'FAILED'/);
  assert.match(source, /TikTok sedang mengunduh gambar dari AI Ads Lab\. Proses masih berjalan/);
  assert.match(source, /globalThis\.pollDraft\s*=\s*reliableTikTokPollDraft/);
});

test('browser exposes cancel for a pending share and blocks another upload until it stops', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/background-state.js'), 'utf8');
  assert.match(source, /cancel-tiktok-upload/);
  assert.match(source, /\/cancel-tiktok\/\$\{encodeURIComponent\(publishId\)\}/);
  assert.match(source, /upload\.disabled\s*=\s*true/);
  assert.match(source, /Upload baru tetap dikunci sampai task lama benar-benar berhenti/);
  assert.match(source, /PENDING_STATUSES/);
  assert.match(source, /installShowSync/);
});
