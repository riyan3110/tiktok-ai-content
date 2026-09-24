const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const webSearch = require('../src/services/webSearchProviders');
const bridge = require('../src/services/dynamicTextBridge');

const jsonRes = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

// This is the REAL chat code path (dynamicTextBridge.installChatBridge uses
// sourceContextFor). AI Chat has web search permanently ON — there is no toggle
// and no search button. Every message with no URL must trigger a forced web
// search so the model answers from fresh cited sources.
test('AI Chat searches the web on every message (no toggle, no button, force mode)', async () => {
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
  // Provider saved; then disable that individual provider. Chat search must
  // STILL run because it's forced/unconditional — no toggle, no button gates it.
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, transport);
  const st = webSearch.publicState(db);
  webSearch.setProviderEnabled(db, st.providers[0].id, false);

  const out = await bridge.sourceContextFor(db, 'berita sepak bola terbaru', transport);
  assert.ok(searched.length >= 1, 'a real web search must be issued for a plain question');
  assert.ok(out.context.includes('WEB_SEARCH'), 'grounded web context is injected');
  assert.ok(out.citations.length >= 1, 'citations returned to the client');
});

test('AI Chat with a pasted URL reads that page instead of searching', async () => {
  const db = createDatabase(':memory:');
  let searchCalls = 0;
  // Save provider first with a transport that returns a valid probe result.
  const saveTransport = async () => jsonRes({ results: [{ title: 'probe', url: 'https://x/1', content: 'ok' }] });
  await webSearch.saveProvider(db, { baseUrl: 'https://api.tavily.com', apiKey: 'tv-key' }, saveTransport);
  // Now the real message transport: count search calls, serve page HTML.
  const transport = async (url) => {
    const u = new URL(String(url));
    if (u.hostname.includes('tavily.com')) { searchCalls += 1; return jsonRes({ results: [] }); }
    return new Response('<html><body><h1>Judul</h1><p>Isi halaman berita.</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const out = await bridge.sourceContextFor(db, 'ringkas https://news.example/artikel', transport);
  assert.equal(searchCalls, 0, 'must not run web search when a URL is provided');
  assert.ok(typeof out.context === 'string');
});

test('floating chat UI has NO web-search button and NO enable checkbox', () => {
  const chat = fs.readFileSync(path.join(__dirname, '..', 'public', 'floating-chat.js'), 'utf8');
  assert.doesNotMatch(chat, /aiads-chat-websearch/, 'magnifier search button must be removed');
  assert.doesNotMatch(chat, /webSearchButton/, 'search button JS must be removed');
  const provider = fs.readFileSync(path.join(__dirname, '..', 'public', 'web-search-providers.js'), 'utf8');
  assert.doesNotMatch(provider, /id="ws-enabled"/, 'enable checkbox input must be removed');
  assert.doesNotMatch(provider, /Aktifkan Web Search di AI Chat/, 'checkbox label must be removed');
});
