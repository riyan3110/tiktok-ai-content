const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchSources, buildSourceContext, validateSourceUrls } = require('../src/services/sourceFetcher');
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const html = '<html><head><title>Judul &amp; Sumber</title><style>.x{}</style><script>bad()</script></head><body><header>Menu</header><main><h1>Artikel</h1><p>' + 'Isi penting dari halaman sumber yang harus dipakai model. '.repeat(8) + '</p></main><footer>Kaki</footer></body></html>';

test('sourceFetcher menghapus duplikat dan membatasi maksimal 3 URL', () => {
  assert.deepEqual(validateSourceUrls(['https://a.test/x', 'https://a.test/x']), ['https://a.test/x']);
  assert.throws(() => validateSourceUrls(['https://a.test/1','https://a.test/2','https://a.test/3','https://a.test/4']), /Maksimal 3/);
});

test('sourceFetcher menolak protocol dan jaringan internal', async () => {
  await assert.rejects(() => fetchSources(['ftp://example.com/a'], { lookup: publicLookup }), /http atau https/);
  await assert.rejects(() => fetchSources(['http://localhost/a'], { lookup: publicLookup }), /localhost/);
  await assert.rejects(() => fetchSources(['http://192.168.1.5/a'], { lookup: publicLookup }), /internal/);
});

test('sourceFetcher membersihkan HTML dan menolak halaman terlalu kecil', async () => {
  const fetchImpl = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  const [source] = await fetchSources(['https://example.com/article'], { fetchImpl, lookup: publicLookup });
  assert.equal(source.title, 'Judul & Sumber');
  assert.match(source.text, /Isi penting/);
  assert.doesNotMatch(source.text, /bad\(\)|\.x|Menu|Kaki/);
  assert.match(buildSourceContext([source]), /<SOURCE id="source-1">\nTITLE: Judul & Sumber\nURL:/);
  await assert.rejects(() => fetchSources(['https://example.com/small'], { fetchImpl: async () => new Response('<p>pendek</p>', { headers: { 'content-type': 'text/html' } }), lookup: publicLookup }), /terlalu pendek/);
});


test('sourceFetcher menolak DNS rebind saat koneksi dan IPv4-mapped IPv6 internal', async () => {
  let calls = 0;
  const lookup = async () => [{ address: ++calls === 1 ? '93.184.216.34' : '192.168.1.5', family: 4 }];
  let fetched = false;
  await assert.rejects(() => fetchSources(['https://example.com/rebind'], { lookup, fetchImpl: async () => { fetched = true; return new Response(html, { headers: { 'content-type': 'text/html' } }); } }), /internal/);
  assert.equal(fetched, false);
  await assert.rejects(() => fetchSources(['http://[::ffff:192.168.1.1]/'], { lookup: publicLookup }), /internal/);
});

test('sourceFetcher memvalidasi redirect ke IP atau hostname private', async () => {
  const redirectToPrivateIp = async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
  await assert.rejects(() => fetchSources(['https://example.com/redirect-ip'], { lookup: publicLookup, fetchImpl: redirectToPrivateIp }), /localhost|internal/);
  const lookup = async (host) => [{ address: host === 'private.test' ? '10.0.0.5' : '93.184.216.34', family: 4 }];
  const redirectToPrivateHost = async () => new Response('', { status: 302, headers: { location: 'http://private.test/secret' } });
  await assert.rejects(() => fetchSources(['https://example.com/redirect-host'], { lookup, fetchImpl: redirectToPrivateHost }), /internal/);
});

test('sourceFetcher memakai reader fallback hanya untuk Reuters yang menolak fetch langsung', async () => {
  const calls = [];
  const article = 'Meta memperkenalkan Muse Glimmer sebagai model open-weight untuk tugas agentic. '.repeat(8);
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (url.startsWith('https://www.reuters.com/')) {
      return new Response('blocked', { status: 401, headers: { 'content-type': 'text/html' } });
    }
    if (url.startsWith('https://r.jina.ai/')) {
      return new Response(JSON.stringify({ data: { title: 'Meta launches new AI model', content: article } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`URL tidak terduga: ${url}`);
  };

  const originalUrl = 'https://www.reuters.com/world/china/meta-launches-new-ai-model';
  const [source] = await fetchSources([originalUrl], { fetchImpl, lookup: publicLookup });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, originalUrl);
  assert.equal(calls[1].url, `https://r.jina.ai/${originalUrl}`);
  assert.equal(calls[1].headers.Accept, 'application/json');
  assert.equal(source.url, originalUrl);
  assert.equal(source.finalUrl, originalUrl);
  assert.equal(source.title, 'Meta launches new AI model');
  assert.match(source.text, /Muse Glimmer/);
});

test('sourceFetcher tidak mengubah kegagalan 401 situs selain Reuters', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('blocked', { status: 401, headers: { 'content-type': 'text/html' } });
  };
  await assert.rejects(() => fetchSources(['https://example.com/private-article'], { fetchImpl, lookup: publicLookup }), /HTTP 401/);
  assert.equal(calls, 1);
});
