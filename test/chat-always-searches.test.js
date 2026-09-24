const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const webSearch = require('../src/services/webSearchProviders');
const bridge = require('../src/services/dynamicTextBridge');

const jsonRes = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

// AI Chat has TWO send buttons with different behavior:
//  - search button (🔍) => wantSearch=true => browse the web first, then answer;
//  - normal send      => wantSearch=false => plain conversation, no browsing.
// This is the REAL chat path (dynamicTextBridge.sourceContextFor).

test('search button (wantSearch=true) triggers a real web search + citations', async () => {
  const db = createDatabase(':memory:');
  const searched = [];
  const transport = async (url, options = {}) => {
    const u = new URL(String(url));
    if (u.hostname.includes('tavily.com')) {
      searched.push(String(url));
      const body = JSON.parse(options.body);
      return jsonRes({ results: [
        { title: `Berita: ${body.query}`, url: 'https://news.example/x', content: 'Isi berita terverifikasi.' }
      ] });
    }
    return new Response('nf', { status: 404 });
  };
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, transport);
  const out = await bridge.sourceContextFor(db, 'berita sepak bola terbaru', transport, true);
  assert.ok(searched.length >= 1, 'search button must issue a real web search');
  assert.ok(out.context.includes('WEB_SEARCH'), 'grounded web context injected');
  assert.ok(out.citations.length >= 1, 'citations returned');
});

test('normal send (wantSearch=false) does NOT browse the web', async () => {
  const db = createDatabase(':memory:');
  let searchCalls = 0;
  const saveTransport = async () => jsonRes({ results: [{ title: 'probe', url: 'https://x/1', content: 'ok' }] });
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, saveTransport);
  const transport = async (url) => {
    if (String(url).includes('tavily.com')) { searchCalls += 1; return jsonRes({ results: [] }); }
    return new Response('nf', { status: 404 });
  };
  const out = await bridge.sourceContextFor(db, 'halo apa kabar', transport, false);
  assert.equal(searchCalls, 0, 'normal send must not search the web');
  assert.equal(out.context, '', 'no web context for plain chat');
  assert.equal(out.citations.length, 0);
});

test('a pasted URL is read regardless of mode (even on normal send)', async () => {
  const db = createDatabase(':memory:');
  let searchCalls = 0;
  const saveTransport = async () => jsonRes({ results: [{ title: 'probe', url: 'https://x/1', content: 'ok' }] });
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, saveTransport);
  const transport = async (url) => {
    if (String(url).includes('tavily.com')) { searchCalls += 1; return jsonRes({ results: [] }); }
    return new Response('<html><body><h1>Judul</h1><p>Isi halaman.</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const out = await bridge.sourceContextFor(db, 'ringkas https://news.example/artikel', transport, false);
  assert.equal(searchCalls, 0, 'URL path must not call the search API');
  assert.ok(typeof out.context === 'string');
});

test('floating chat UI: search button + send button both exist, distinct handlers', () => {
  const chat = fs.readFileSync(path.join(__dirname, '..', 'public', 'floating-chat.js'), 'utf8');
  assert.match(chat, /aiads-chat-websearch/, 'search (magnifier) button must exist');
  assert.match(chat, /aiads-chat-send/, 'normal send button must exist');
  // Search button sends with useSearch=true; form submit sends with false.
  assert.match(chat, /sendMessage\(text,true\)/, 'search button => browse the web');
  assert.match(chat, /sendMessage\(input\.value,false\)/, 'send button => plain chat');
  // No enable checkbox in the provider config page.
  const provider = fs.readFileSync(path.join(__dirname, '..', 'public', 'web-search-providers.js'), 'utf8');
  assert.doesNotMatch(provider, /id="ws-enabled"/, 'enable checkbox must stay removed');
});
