const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDatabase } = require('../src/db');
const webSearch = require('../src/services/webSearchProviders');
const floatingChat = require('../src/services/floatingChatPatch');

const jsonRes = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

// Mock Tavily (POST /search, Bearer) + You.com v1 (POST /v1/search, X-API-Key).
function multiTransport(calls) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const u = new URL(String(url));
    if (u.hostname.includes('tavily.com')) {
      assert.match(options.headers.Authorization, /Bearer /);
      const body = JSON.parse(options.body);
      return jsonRes({ results: [
        { title: `Tavily A: ${body.query}`, url: 'https://tav.example/a', content: 'Isi tavily A' },
        { title: 'Tavily B', url: 'https://tav.example/b', content: 'Isi tavily B' }
      ] });
    }
    if (u.hostname.includes('ydc-index.io') || u.hostname.includes('you.com')) {
      assert.equal(options.headers['X-API-Key'], 'yc-key');
      assert.match(u.pathname, /\/v1\/search$/);
      // Real You.com v1 POST shape: results is an OBJECT with web/news arrays,
      // each web row carries contents.highlights (extraction_mode: highlights).
      return jsonRes({ results: {
        web: [
          { title: 'You A', url: 'https://you.example/a', contents: { highlights: ['You highlight A1', 'You highlight A2'] } },
          { title: 'You B', url: 'https://you.example/b', description: 'You desc B' }
        ],
        news: [ { title: 'You News', url: 'https://you.example/news', description: 'berita' } ]
      } });
    }
    return new Response('not found', { status: 404 });
  };
}

test('buildSearchRequest: youcom v1 uses POST /v1/search + extraction body', () => {
  const yc = webSearch.buildSearchRequest('youcom', 'https://ydc-index.io', 'k', 'halo', 5);
  assert.match(yc.url, /\/v1\/search$/);
  assert.equal(yc.init.method, 'POST');
  assert.equal(yc.init.headers['X-API-Key'], 'k');
  assert.match(yc.init.body, /extraction_mode/);

  const classic = webSearch.buildSearchRequest('youcom_classic', 'https://api.you.com', 'k', 'halo', 5);
  assert.equal(classic.init.method, 'GET');
  assert.match(classic.url, /\/search\?query=halo/);

  const tv = webSearch.buildSearchRequest('tavily', 'https://api.tavily.com', 'k', 'halo', 5);
  assert.equal(tv.init.method, 'POST');
  assert.match(tv.init.headers.Authorization, /Bearer k/);
});

test('youcomUrl keeps a single version segment', () => {
  assert.equal(webSearch.youcomUrl('https://ydc-index.io'), 'https://ydc-index.io/v1/search');
  assert.equal(webSearch.youcomUrl('https://ydc-index.io/v1'), 'https://ydc-index.io/v1/search');
});

test('parseSearchResults understands hits/results/web.results/organic + highlights', () => {
  assert.equal(webSearch.parseSearchResults({ hits: [{ title: 'A', url: 'https://a.com', highlights: ['h1', 'h2'] }] }, 5)[0].snippet, 'h1 h2');
  assert.equal(webSearch.parseSearchResults({ results: [{ name: 'B', link: 'https://b.com' }] }, 5).length, 1);
  assert.equal(webSearch.parseSearchResults({ web: { results: [{ title: 'C', url: 'https://c.com' }] } }, 5).length, 1);
  assert.equal(webSearch.parseSearchResults({ organic_results: [{ title: 'D', link: 'https://d.com' }] }, 5).length, 1);
  assert.equal(webSearch.parseSearchResults({ results: [{ title: 'X', url: 'ftp://nope' }] }, 5).length, 0);
});

test('parseSearchResults understands the REAL You.com v1 POST shape (results.web + contents.highlights)', () => {
  const payload = { results: {
    web: [
      { title: 'W1', url: 'https://w.com/1', contents: { highlights: ['hi one', 'hi two'] } },
      { title: 'W2', url: 'https://w.com/2', description: 'plain desc', snippets: ['snip'] }
    ],
    news: [ { title: 'N1', url: 'https://n.com/1', description: 'news desc' } ],
    knowledge: [ { title: 'K1', url: 'https://k.com/1', description: 'kb' } ]
  } };
  const rows = webSearch.parseSearchResults(payload, 10);
  assert.equal(rows.length, 4); // web(2) + news(1) + knowledge(1)
  assert.equal(rows[0].snippet, 'hi one hi two'); // highlights preferred
  assert.equal(rows[1].snippet, 'plain desc');    // description over snippets when present
  assert.equal(rows[2].url, 'https://n.com/1');
});

test('detectFormat + defaultRoleFor assign Tavily=primary, You.com=verify', () => {
  assert.equal(webSearch.detectFormat('https://api.tavily.com'), 'tavily');
  assert.equal(webSearch.detectFormat('https://ydc-index.io'), 'youcom');
  assert.equal(webSearch.defaultRoleFor('tavily'), 'primary');
  assert.equal(webSearch.defaultRoleFor('youcom'), 'verify');
  assert.equal(webSearch.defaultRoleFor('generic'), 'auto');
});

test('save validates with a REAL search and rejects empty results', async () => {
  const db = createDatabase(':memory:');
  const calls = [];
  const transport = multiTransport(calls);
  const saved = await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, transport);
  assert.equal(saved.saved.format, 'tavily');
  assert.equal(saved.saved.role, 'primary');
  assert.equal(saved.enabled, true);
  assert.ok(calls.some(c => c.url.includes('tavily.com/search')));

  const emptyTransport = async () => jsonRes({ nothing: true });
  await assert.rejects(
    () => webSearch.saveProvider(db, { baseUrl: 'https://api.other.dev', apiKey: 'k', format: 'generic' }, emptyTransport),
    /tidak mengembalikan hasil/
  );
});

test('ROUTER: single provider -> plan single', async () => {
  const db = createDatabase(':memory:');
  const transport = multiTransport([]);
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, transport);
  const out = await webSearch.routeSearch(db, 'kabar terbaru', transport, 5);
  assert.equal(out.plan, 'single');
  assert.equal(out.providers.length, 1);
  assert.ok(out.results.length >= 1);
});

test('ROUTER: two providers, ordinary query -> primary only (cost-aware)', async () => {
  const db = createDatabase(':memory:');
  const transport = multiTransport([]);
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, transport);           // primary
  await webSearch.saveProvider(db, { baseUrl: 'https://ydc-index.io', apiKey: 'yc-key', format: 'youcom' }, transport); // verify
  const calls = [];
  const traced = (url, opt) => { calls.push(String(url)); return transport(url, opt); };
  const out = await webSearch.routeSearch(db, 'apa yang viral hari ini', traced, 5);
  assert.equal(out.plan, 'primary');
  assert.deepEqual(out.providers, ['Tavily']);
  assert.ok(calls.every(u => u.includes('tavily.com')), 'ordinary query must not call the verify provider');
});

test('ROUTER: verification query -> both providers, merged + deduped, tagged by source', async () => {
  const db = createDatabase(':memory:');
  const transport = multiTransport([]);
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, transport);
  await webSearch.saveProvider(db, { baseUrl: 'https://ydc-index.io', apiKey: 'yc-key', format: 'youcom' }, transport);
  const out = await webSearch.routeSearch(db, 'tolong verifikasi klaim ini benar atau hoaks', transport, 6);
  assert.equal(out.plan, 'both');
  assert.deepEqual(out.providers.sort(), ['Tavily', 'Ydc Index']);
  // interleaved: first Tavily, then the verify provider
  assert.equal(out.results[0].source, 'Tavily');
  assert.ok(out.results.some(r => r.source === 'Ydc Index'));
  // dedupe by URL key (no duplicate URLs)
  const urls = out.results.map(r => r.url);
  assert.equal(urls.length, new Set(urls.map(u => u.toLowerCase())).size);
});

test('ROUTER: escalates to verify when primary returns too few results', async () => {
  const db = createDatabase(':memory:');
  const transport = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname.includes('tavily.com')) return jsonRes({ results: [{ title: 'lone', url: 'https://tav.example/lone', content: 'x' }] }); // 1 result < MIN
    if (u.hostname.includes('ydc-index.io')) return jsonRes({ hits: [{ title: 'You A', url: 'https://you.example/a', snippets: ['s'] }] });
    return new Response('nf', { status: 404 });
  };
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, transport);
  await webSearch.saveProvider(db, { baseUrl: 'https://ydc-index.io', apiKey: 'yc-key', format: 'youcom' }, transport);
  const out = await webSearch.routeSearch(db, 'query biasa singkat', transport, 6);
  assert.equal(out.plan, 'escalated');
  assert.ok(out.providers.includes('Ydc Index'));
});

test('per-provider enable/disable + role via HTTP routes', async t => {
  const db = createDatabase(':memory:');
  const transport = multiTransport([]);
  const app = express();
  app.use(express.json());
  webSearch.install({ app, db, transport });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // test-before-save does not persist
  const tested = await fetch(`${base}/api/web-search/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }) }).then(r => r.json());
  assert.equal(tested.ok, true);
  assert.equal(webSearch.publicState(db).providers.length, 0);

  const saved = await fetch(`${base}/api/web-search/providers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }) }).then(r => r.json());
  const id = saved.providers[0].id;
  const roled = await fetch(`${base}/api/web-search/providers/${id}/role`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'verify' }) }).then(r => r.json());
  assert.equal(roled.providers[0].role, 'verify');
  const disabled = await fetch(`${base}/api/web-search/providers/${id}/enabled`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) }).then(r => r.json());
  assert.equal(disabled.providers[0].enabled, false);
});

test('floating chat wires router context + citations (with source tags)', async () => {
  const db = createDatabase(':memory:');
  const transport = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname.includes('tavily.com')) return multiTransport([])(url, options);
    if (u.hostname.includes('ydc-index.io')) return multiTransport([])(url, options);
    return new Response('nf', { status: 404 }); // page fetch fails -> snippet fallback
  };
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, transport);
  const out = await floatingChat.webSearchContextFor(db, 'apa kabar terbaru?', transport);
  assert.ok(out.context.includes('WEB_SEARCH'));
  assert.ok(out.context.includes('https://tav.example/a'));
  assert.ok(out.citations.length >= 1);
});
