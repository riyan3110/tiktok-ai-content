const crypto = require('node:crypto');
const aiConnector = require('../ai/connector');
const dynamicAi = require('./dynamicAiProviders');
const { StorageService } = require('../storage/service');
const sourceFetcher = require('./sourceFetcher');
const webSearch = require('./webSearchProviders');

const MAX_HISTORY_MESSAGES = 16;
const MAX_CONTEXT_CHARS = 12000;
const MAX_MESSAGE_CHARS = 12000;
const MAX_VISION_IMAGES = 4;
const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 5;

function ensureColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS floating_chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      provider TEXT,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS floating_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES floating_chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_floating_chat_messages_session
      ON floating_chat_messages(session_id, id);
    CREATE INDEX IF NOT EXISTS idx_floating_chat_sessions_updated
      ON floating_chat_sessions(updated_at DESC);
  `);
  ensureColumn(db, 'floating_chat_messages', 'media_type', 'TEXT');
  ensureColumn(db, 'floating_chat_messages', 'media_url', 'TEXT');
  ensureColumn(db, 'floating_chat_messages', 'asset_id', 'TEXT');
  ensureColumn(db, 'floating_chat_messages', 'job_id', 'TEXT');
  ensureColumn(db, 'floating_chat_messages', 'attachments_json', "TEXT NOT NULL DEFAULT '[]'");
}

function textProviders(db) {
  const state = dynamicAi.publicState(db);
  return state.providers.filter(row => row.roles.includes('text') && row.id === state.defaults.text.providerId)
    .map(row => ({ provider: row.id, name: row.name, textModel: row.textModel, defaultModel: row.textModel, models: row.models, enabled: true, hasApiKey: row.hasApiKey }));
}
function pickProvider(db, requested) {
  const provider = textProviders(db)[0];
  if (!provider || (requested && requested !== provider.provider)) throw Object.assign(new Error('Pilih Default Text AI melalui Provider AI.'), { status: 409 });
  return provider;
}
const modelFor = (provider, requested) => {
  if (requested && requested !== provider.textModel) throw Object.assign(new Error('Model berubah. Pilih model melalui Provider AI.'), { status: 409 });
  return provider.textModel;
};
const getSession = (db, id) => db.prepare('SELECT * FROM floating_chat_sessions WHERE id=?').get(id);

function sessionJson(row) {
  return row && { id: row.id, title: row.title, provider: row.provider, model: row.model, createdAt: row.created_at, updatedAt: row.updated_at };
}

function parseAttachments(value) {
  try {
    const ids = JSON.parse(value || '[]');
    return Array.isArray(ids) ? ids.map(String).filter(Boolean).map(id => ({ id, previewUrl: `/api/assets/${encodeURIComponent(id)}/preview` })) : [];
  } catch (_) { return []; }
}

function messageJson(row) {
  return row && {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    provider: row.provider,
    model: row.model,
    mediaType: row.media_type || null,
    mediaUrl: row.media_url || null,
    assetId: row.asset_id || null,
    jobId: row.job_id || null,
    attachments: parseAttachments(row.attachments_json),
    createdAt: row.created_at
  };
}

function sendError(res, error) {
  const rawStatus = Number(error?.status || error?.cause?.status || 0);
  const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 502;
  const message = String(error?.message || error?.cause?.message || 'Gagal menghubungi AI provider.');
  return res.status(status).json({ error: message, message, type: error?.type || null, status });
}

function extractUrls(text = '') {
  const matches = String(text).match(/https?:\/\/[^\s<>()\[\]{}"']+/gi) || [];
  return [...new Set(matches.map(value => value.replace(/[.,!?;:]+$/, '')))].slice(0, 3);
}

function buildConversationMessages(rows, sourceContext = '') {
  const selected = [];
  let used = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const content = String(row?.content || '');
    if (selected.length && used + content.length > MAX_CONTEXT_CHARS) break;
    selected.unshift({ role: row?.role === 'assistant' ? 'assistant' : 'user', content });
    used += content.length;
  }

  if (sourceContext && selected.length) {
    for (let index = selected.length - 1; index >= 0; index -= 1) {
      if (selected[index].role !== 'user') continue;
      selected[index] = {
        ...selected[index],
        content: `${selected[index].content}\n\n[Retrieved web content]\n${sourceContext}`
      };
      break;
    }
  }

  return selected;
}

function buildConversationPrompt(rows, sourceContext = '') {
  return buildConversationMessages(rows, sourceContext)
    .map(message => `${message.role}: ${message.content}`)
    .join('\n\n');
}

async function prepareVisionAssets(storage, assetIds = []) {
  const ids = [...new Set((Array.isArray(assetIds) ? assetIds : []).map(String).filter(Boolean))].slice(0, MAX_VISION_IMAGES);
  if (!ids.length) return [];
  const output = [];
  for (const id of ids) {
    const asset = storage.repository.get(id);
    if (!asset) throw Object.assign(new Error(`Asset tidak ditemukan: ${id}`), { status: 404 });
    const preview = await storage.preview(asset);
    if (!String(preview.mimeType || '').startsWith('image/')) throw Object.assign(new Error('Attachment chat untuk vision harus berupa gambar.'), { status: 422 });
    if (preview.data.length > MAX_VISION_IMAGE_BYTES) throw Object.assign(new Error('Ukuran gambar untuk dibaca AI maksimal 8 MB per gambar.'), { status: 413 });
    output.push({ data: preview.data.toString('base64'), mimeType: preview.mimeType, name: asset.name });
  }
  return output;
}

async function webContextFor(content, transport) {
  const urls = extractUrls(content);
  if (!urls.length) return '';
  try {
    const sources = await sourceFetcher.fetchSources(urls, transport ? { fetchImpl: transport } : {});
    return sourceFetcher.buildSourceContext(sources);
  } catch (error) {
    return `<SOURCE_ERROR>${String(error.message || 'URL tidak dapat dibaca').slice(0, 500)}</SOURCE_ERROR>`;
  }
}

// Web Search router: when enabled, search the web for the user's question,
// fetch the top result pages, and return grounded source context + a citation
// list. Mirrors the reference diagram: cari di web -> ambil hasil + sumber ->
// AI merangkum -> jawaban + citation/link sumber. Degrades to '' on any error
// so the chat still answers from model knowledge.
async function webSearchContextFor(db, content, transport) {
  let searchResult;
  try {
    searchResult = await webSearch.searchForChat(db, content, transport, MAX_SEARCH_RESULTS);
  } catch (error) {
    return { context: `<SEARCH_ERROR>${String(error.message || 'Pencarian gagal').slice(0, 300)}</SEARCH_ERROR>`, citations: [] };
  }
  if (!searchResult.enabled || !searchResult.results.length) return { context: '', citations: [] };

  const citations = searchResult.results.map((row, index) => ({ index: index + 1, title: row.title, url: row.url, snippet: row.snippet }));
  const topUrls = citations.slice(0, 3).map(c => c.url);
  let pageContext = '';
  try {
    const sources = await sourceFetcher.fetchSources(topUrls, transport ? { fetchImpl: transport } : {});
    pageContext = sourceFetcher.buildSourceContext(sources);
  } catch (_) {
    // Fetching full pages can fail (paywall/anti-bot); fall back to snippets.
    pageContext = '';
  }

  const resultBlock = citations
    .map(c => `[${c.index}] ${c.title || c.url}\nURL: ${c.url}${c.snippet ? `\nRINGKASAN: ${c.snippet}` : ''}`)
    .join('\n\n');
  const context = [
    `<WEB_SEARCH provider="${searchResult.provider || 'web'}">`,
    resultBlock,
    pageContext ? `\n[ISI HALAMAN TERAMBIL]\n${pageContext}` : '',
    '</WEB_SEARCH>',
    '\nInstruksi: Jawab pertanyaan memakai hasil pencarian di atas. Sertakan sitasi berupa nomor [n] di kalimat yang relevan, lalu di akhir jawaban tulis daftar "Sumber:" berisi nomor beserta link URL-nya.'
  ].filter(Boolean).join('\n');

  return { context: context.slice(0, MAX_CONTEXT_CHARS), citations };
}

async function executeTextProvider(db, providerId, model, messages, transport, assets = []) {
  modelFor(pickProvider(db, providerId), model);
  const parts = assets.map(asset => ({ type: 'image_url', image_url: { url: `data:${asset.mimeType};base64,${asset.data}` } }));
  if (parts.length) messages = messages.map((message, index) => index === messages.length - 1 ? { ...message, content: [{ type: 'text', text: String(message.content || '') }, ...parts] } : message);
  const result = await dynamicAi.executeMessages(db, messages, transport);
  return { ...result, content: result.text };
}

function updateSessionFromUser(db, session, content, provider, model) {
  const firstUserCount = db.prepare("SELECT COUNT(*) AS count FROM floating_chat_messages WHERE session_id=? AND role='user'").get(session.id).count;
  const title = firstUserCount === 1 ? content.replace(/\s+/g, ' ').slice(0, 54) : session.title;
  db.prepare('UPDATE floating_chat_sessions SET title=?,provider=?,model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(title || 'New chat', provider, model, session.id);
}

function install({ app, db, transport } = {}) {
  if (!app || !db) throw new Error('Floating chat patch membutuhkan app dan db.');
  ensureSchema(db);
  const storage = new StorageService({ db });

  app.get('/api/floating-chat/providers', (req, res) => {
    const providers = textProviders(db);
    const defaultId = dynamicAi.publicState(db).defaults.text.providerId;
    let search = { enabled: false, configured: false };
    try {
      const searchState = webSearch.publicState(db);
      search = { enabled: Boolean(searchState.enabled), configured: Boolean(searchState.selectedProviderId) };
    } catch (_) { /* web search optional */ }
    res.json({ providers, defaultProvider: defaultId, search });
  });

  app.get('/api/floating-chat/providers/:provider/models', async (req, res) => {
    try {
      const provider = pickProvider(db, req.params.provider);
      res.json({ provider: provider.provider, models: provider.models, selectedModel: provider.textModel });
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/floating-chat/sessions', (req, res) => res.json(db.prepare('SELECT * FROM floating_chat_sessions ORDER BY updated_at DESC LIMIT 30').all().map(sessionJson)));

  app.post('/api/floating-chat/sessions', (req, res) => {
    try {
      const provider = pickProvider(db, req.body?.provider);
      const model = modelFor(provider, req.body?.model);
      if (!model) throw Object.assign(new Error('Model Text AI belum dipilih.'), { status: 422 });
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO floating_chat_sessions(id,title,provider,model) VALUES(?,?,?,?)').run(id, 'New chat', provider.provider, model);
      res.status(201).json(sessionJson(getSession(db, id)));
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/floating-chat/sessions/:id/messages', (req, res) => {
    const session = getSession(db, req.params.id);
    if (!session) return res.status(404).json({ error: 'Chat tidak ditemukan.' });
    const messages = db.prepare('SELECT * FROM floating_chat_messages WHERE session_id=? ORDER BY id ASC').all(req.params.id);
    res.json({ session: sessionJson(session), messages: messages.map(messageJson) });
  });

  app.delete('/api/floating-chat/sessions/:id', (req, res) => {
    const deleted = db.prepare('DELETE FROM floating_chat_sessions WHERE id=?').run(req.params.id).changes;
    res.status(deleted ? 200 : 404).json({ deleted: Boolean(deleted) });
  });

  app.post('/api/floating-chat/sessions/:id/messages', async (req, res) => {
    try {
      const session = getSession(db, req.params.id);
      if (!session) return res.status(404).json({ error: 'Chat tidak ditemukan.' });
      const content = String(req.body?.content || '').trim();
      if (!content) throw Object.assign(new Error('Pesan tidak boleh kosong.'), { status: 422 });
      if (content.length > MAX_MESSAGE_CHARS) throw Object.assign(new Error('Pesan terlalu panjang.'), { status: 422 });

      const provider = pickProvider(db, req.body?.provider || session.provider);
      const model = modelFor(provider, req.body?.model || session.model);
      if (!model) throw Object.assign(new Error('Model Text AI belum dipilih.'), { status: 422 });
      const assetIds = [...new Set((Array.isArray(req.body?.assetIds) ? req.body.assetIds : []).map(String).filter(Boolean))].slice(0, MAX_VISION_IMAGES);

      const userResult = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model,attachments_json) VALUES(?,?,?,?,?,?)').run(session.id, 'user', content, provider.provider, model, JSON.stringify(assetIds));
      updateSessionFromUser(db, session, content, provider.provider, model);

      const history = db.prepare('SELECT role,content FROM floating_chat_messages WHERE session_id=? ORDER BY id DESC LIMIT ?').all(session.id, MAX_HISTORY_MESSAGES).reverse();
      const urls = extractUrls(content);
      const wantSearch = req.body?.webSearch === true;
      let sourceContext = '';
      let visionAssets = [];
      let searchCitations = [];
      const [urlContext, visionResult, searchResult] = await Promise.all([
        urls.length ? webContextFor(content, transport) : Promise.resolve(''),
        assetIds.length ? prepareVisionAssets(storage, assetIds) : Promise.resolve([]),
        wantSearch && !urls.length ? webSearchContextFor(db, content, transport) : Promise.resolve({ context: '', citations: [] })
      ]);
      visionAssets = visionResult;
      searchCitations = searchResult.citations || [];
      // Prefer explicit URL context; otherwise use web-search context when enabled.
      sourceContext = [urlContext, searchResult.context].filter(Boolean).join('\n\n');

      const messages = buildConversationMessages(history, sourceContext);
      const result = await executeTextProvider(
        db,
        provider.provider,
        model,
        messages,
        transport,
        visionAssets
      );

      const answer = String(result?.content || '').trim();
      if (!answer) throw Object.assign(new Error('Provider tidak mengembalikan jawaban.'), { status: 502 });

      const assistantResult = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model) VALUES(?,?,?,?,?)').run(session.id, 'assistant', answer, provider.provider, model);
      db.prepare('UPDATE floating_chat_sessions SET provider=?,model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(provider.provider, model, session.id);
      res.json({
        session: sessionJson(getSession(db, session.id)),
        user: messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(userResult.lastInsertRowid)),
        assistant: messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(assistantResult.lastInsertRowid)),
        citations: searchCitations
      });
    } catch (error) { sendError(res, error); }
  });
}

module.exports = { install, ensureSchema, buildConversationMessages, buildConversationPrompt, textProviders, executeTextProvider, sendError, messageJson, webSearchContextFor };
