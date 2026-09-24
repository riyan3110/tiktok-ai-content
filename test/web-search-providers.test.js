const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDatabase } = require('../src/db');
const webSearch = require('../src/services/webSearchProviders');
const floatingChat = require('../src/services/floatingChatPatch');

// A You.com-shaped mock search API + a generic-shaped one, plus a page fetcher.
function youcomTransport(calls) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const u = new URL(String(url));
    if (u.pathname.endsWith('/search')) {
      const query = u.searchParams.get('query') || '';
      assert.equal(options.headers['X-API-Key'], 'yc-key');
      return new Response(JSON.stringify({
        hits: [
          { title: `Hasil A untuk ${query}`, url: 'https://example.com/a', snippets: ['Ringkasan A satu', 'Ringkasan A dua'] },
          { title: 'Hasil B', url: 'https://example.com/b', description: 'Ringkasan B' }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
}

test('webSearchProviders: parseSearchResults understands multiple provider shapes', () => {
  assert.equal(webSearch.parseSearchResults({ hits: [{ title: 'A', url: 'https://a.com', snippet: 's' }] }, 5).length, 1);
  assert.equal(webSearch.parseSearchResults({ results: [{ name: 'B', link: 'https://b.com' }] }, 5).length, 1);
  assert.equal(webSearch.parseSearchResults({ web: { results: [{ title: 'C', url: 'https://c.com' }] } }, 5).length, 1);
  assert.equal(webSearch.parseSearchResults({ organic_results: [{ title: 'D', link: 'https://d.com' }] }, 5).length, 1);
  // rows without a valid http url are dropped
  assert.equal(webSearch.parseSearchResults({ results: [{ title: 'X', url: 'ftp://nope' }] }, 5).length, 0);
});

test('webSearchProviders: detectFormat picks the right preset and stays generic otherwise', () => {
  assert.equal(webSearch.detectFormat('https://api.ydc-index.io'), 'youcom');
  assert.equal(webSearch.detectFormat('https://api.tavily.com'), 'tavily');
  assert.equal(webSearch.detectFormat('https://api.anyprovider.dev'), 'generic');
});

test('webSearchProviders: buildSearchRequest shapes each provider format correctly', () => {
  const yc = webSearch.buildSearchRequest('youcom', 'https://api.ydc-index.io', 'k', 'halo', 5);
  assert.match(yc.url, /\/search\?query=halo/);
  assert.equal(yc.init.method, 'GET');
  assert.equal(yc.init.headers['X-API-Key'], 'k');

  const tv = webSearch.buildSearchRequest('tavily', 'https://api.tavily.com', 'k', 'halo', 5);
  assert.equal(tv.init.method, 'POST');
  assert.match(tv.init.headers.Authorization, /Bearer k/);
  assert.match(tv.init.body, /"query":"halo"/);

  const gen = webSearch.buildSearchRequest('generic', 'https://api.other.dev', 'k', 'halo', 5);
  assert.equal(gen.init.method, 'POST');
  assert.match(gen.init.body, /"query":"halo"/);
});

test('webSearchProviders: save validates with a REAL search, then search/enable/remove works', async () => {
  const db = createDatabase(':memory:');
  const calls = [];
  const transport = youcomTransport(calls);

  // Saving runs a real probe search; empty results would reject.
  const saved = await webSearch.saveProvider(db, { baseUrl: 'https://api.ydc-index.io', apiKey: 'yc-key', format: 'auto' }, transport);
  assert.equal(saved.providers.length, 1);
  assert.equal(saved.enabled, true);
  assert.equal(saved.saved.format, 'youcom');
  assert.ok(saved.saved.sampleCount >= 1);
  assert.ok(calls.some(c => c.url.includes('/search')), 'probe search must hit the provider');

  // searchForChat returns parsed rows when enabled.
  const result = await webSearch.searchForChat(db, 'kabar terbaru', transport, 5);
  assert.equal(result.enabled, true);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].url, 'https://example.com/a');
  assert.match(result.results[0].snippet, /Ringkasan A/);

  // Disable -> searchForChat degrades to empty (no throw).
  webSearch.setEnabled(db, false);
  const disabled = await webSearch.searchForChat(db, 'kabar', transport, 5);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.results.length, 0);

  // Remove -> state cleared.
  const state = webSearch.publicState(db);
  const after = webSearch.removeProvider(db, state.providers[0].id);
  assert.equal(after.providers.length, 0);
  assert.equal(after.selectedProviderId, null);
});

test('webSearchProviders: save REJECTS a provider that returns no recognizable results', async () => {
  const db = createDatabase(':memory:');
  const transport = async () => new Response(JSON.stringify({ nonsense: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    () => webSearch.saveProvider(db, { baseUrl: 'https://api.other.dev', apiKey: 'k', format: 'generic' }, transport),
    /tidak mengembalikan hasil/
  );
  // Nothing persisted.
  assert.equal(webSearch.publicState(db).providers.length, 0);
});

test('webSearchProviders: HTTP routes expose test-before-save, save, enable, delete', async t => {
  const db = createDatabase(':memory:');
  const calls = [];
  const transport = youcomTransport(calls);
  const app = express();
  app.use(express.json());
  webSearch.install({ app, db, transport });
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // test-before-save proves the search round trip without persisting.
  const tested = await fetch(`${base}/api/web-search/test`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseUrl: 'https://api.ydc-index.io', apiKey: 'yc-key', format: 'auto', query: 'halo' })
  }).then(r => r.json());
  assert.equal(tested.ok, true);
  assert.equal(tested.count, 2);
  assert.equal(webSearch.publicState(db).providers.length, 0, 'test must not persist');

  // save then confirm enabled + selectable.
  const saved = await fetch(`${base}/api/web-search/providers`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseUrl: 'https://api.ydc-index.io', apiKey: 'yc-key' })
  }).then(r => r.json());
  assert.equal(saved.providers.length, 1);
  assert.equal(saved.enabled, true);

  const listed = await fetch(`${base}/api/web-search/providers`).then(r => r.json());
  assert.equal(listed.providers.length, 1);
  assert.equal(listed.providers[0].hasApiKey, true);
});

test('floating chat wires web search context + citations when webSearch flag is on', async () => {
  const db = createDatabase(':memory:');
  const calls = [];
  // transport serves both the search API and (404) page fetches -> snippet fallback.
  const transport = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname.includes('ydc-index.io')) return youcomTransport(calls)(url, options);
    // page fetch attempts fail; webSearchContextFor should still return citations.
    return new Response('not found', { status: 404 });
  };
  await webSearch.saveProvider(db, { baseUrl: 'https://api.ydc-index.io', apiKey: 'yc-key', format: 'auto' }, transport);

  const out = await floatingChat.webSearchContextFor(db, 'apa kabar terbaru?', transport);
  assert.ok(out.context.includes('WEB_SEARCH'), 'context must include the web-search block');
  assert.ok(out.context.includes('https://example.com/a'), 'context must include source URLs');
  assert.equal(out.citations.length, 2);
  assert.equal(out.citations[0].url, 'https://example.com/a');
});
