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
