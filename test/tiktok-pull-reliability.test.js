const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tiktok = require('../src/services/tiktok');

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

test('browser polling does not turn five minutes of PROCESSING_DOWNLOAD into a false failure', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/background-state.js'), 'utf8');
  assert.match(source, /URL_PULL_WINDOW_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(source, /data\.status === 'FAILED'/);
  assert.match(source, /TikTok sedang mengunduh gambar dari AI Ads Lab\. Proses masih berjalan/);
  assert.match(source, /globalThis\.pollDraft\s*=\s*reliableTikTokPollDraft/);
});
