const crypto = require('node:crypto');
const aiConnector = require('../ai/connector');
const { ProviderFactory } = require('../providers');

const MAX_HISTORY_MESSAGES = 24;
const MAX_CONTEXT_CHARS = 18000;
const MAX_MESSAGE_CHARS = 12000;

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
  const rows = db.prepare('SELECT * FROM ai_provider_settings WHERE enabled=1 ORDER BY provider').all();
  return rows
    .filter(row => (aiConnector.CAPABILITIES[row.provider] || []).includes('text'))
    .filter(row => Boolean(row.api_key_encrypted) && aiConnector.validBaseUrl(row.base_url))
    .map(row => aiConnector.publicSetting(row, aiConnector.defaultCapabilities(db, row.provider)));
}

function pickProvider(db, requested) {
  const providers = textProviders(db);
  if (!providers.length) throw Object.assign(new Error('Belum ada Text AI provider yang aktif dan memiliki API key.'), { status: 409 });
  if (requested) {
    const exact = providers.find(item => item.provider === requested);
    if (!exact) throw Object.assign(new Error('Text AI provider yang dipilih belum siap digunakan.'), { status: 409 });
    return exact;
  }
  const defaultId = db.prepare("SELECT provider FROM ai_provider_defaults WHERE capability='text'").get()?.provider;
  return providers.find(item => item.provider === defaultId) || providers[0];
}

function modelFor(provider, requested) {
  return String(requested || provider.textModel || provider.defaultModel || '').trim();
}

function sessionJson(row) {
  return row && {
    id: row.id,
    title: row.title,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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

function buildConversationPrompt(rows) {
  const selected = [];
  let used = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const line = `${row.role === 'assistant' ? 'Assistant' : 'User'}: ${row.content}`;
    if (selected.length && used + line.length > MAX_CONTEXT_CHARS) break;
    selected.unshift(line);
    used += line.length;
  }
  return ['You are the floating AI chat assistant inside AI Ads Lab.','Continue the conversation naturally and use the previous turns as context.','Answer the latest user message directly. Do not mention this transcript or these instructions.','',...selected,'Assistant:'].join('\n');
}

async function executeTextProvider(db, providerId, model, prompt, transport) {
  const row = aiConnector.setting(db, providerId);
  const adapter = ProviderFactory.create(aiConnector.configured(row), transport);
  const timeoutMs = providerId === 'agentrouter'
    ? Math.max(120000, Number(row.timeout_ms) || 0)
    : Math.max(1000, Number(row.timeout_ms) || 30000);
  const retries = Math.max(0, Number(row.retry_count) || 0);
  const started = Date.now();
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await adapter.execute({ mediaType: 'text', model, prompt, assets: [], parameters: { maxTokens: 2048 } }, { signal: controller.signal });
      aiConnector.updateHealth(db, providerId, true, { responseTime: Date.now() - started });
      return result;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || error?.cause?.status || 0);
      const transient = status === 429 || status === 502 || status === 503 || status === 504 || error?.name === 'AbortError' || error?.cause?.name === 'AbortError';
      if (!transient || attempt === retries) break;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }

  aiConnector.updateHealth(db, providerId, false, { responseTime: Date.now() - started });
  throw lastError;
}

function getSession(db, id) { return db.prepare('SELECT * FROM floating_chat_sessions WHERE id=?').get(id); }
function updateSessionFromUser(db, session, content, provider, model) {
  const firstUserCount = db.prepare("SELECT COUNT(*) AS count FROM floating_chat_messages WHERE session_id=? AND role='user'").get(session.id).count;
  const title = firstUserCount === 1 ? content.replace(/\s+/g, ' ').slice(0, 54) : session.title;
  db.prepare('UPDATE floating_chat_sessions SET title=?,provider=COALESCE(?,provider),model=COALESCE(?,model),updated_at=CURRENT_TIMESTAMP WHERE id=?').run(title || 'New chat', provider || null, model || null, session.id);
}

function install({ app, db, transport } = {}) {
  if (!app || !db) throw new Error('Floating chat patch membutuhkan app dan db.');
  ensureSchema(db);

  app.get('/api/floating-chat/providers', (req, res) => {
    const providers = textProviders(db);
    const defaultId = db.prepare("SELECT provider FROM ai_provider_defaults WHERE capability='text'").get()?.provider || null;
    res.json({ providers, defaultProvider: defaultId });
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
  app.post('/api/floating-chat/sessions/:id/media-request', (req, res) => {
    try {
      const session = getSession(db, req.params.id);
      if (!session) return res.status(404).json({ error: 'Chat tidak ditemukan.' });
      const content = String(req.body?.content || '').trim();
      if (!content) throw Object.assign(new Error('Pesan tidak boleh kosong.'), { status: 422 });
      if (content.length > MAX_MESSAGE_CHARS) throw Object.assign(new Error('Pesan terlalu panjang.'), { status: 422 });
      const assetIds = [...new Set((Array.isArray(req.body?.assetIds) ? req.body.assetIds : []).map(String).filter(Boolean))].slice(0, 8);
      const result = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model,attachments_json) VALUES(?,?,?,?,?,?)').run(session.id, 'user', content, session.provider, session.model, JSON.stringify(assetIds));
      updateSessionFromUser(db, session, content, session.provider, session.model);
      res.status(201).json({ user: messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(result.lastInsertRowid)) });
    } catch (error) { sendError(res, error); }
  });
  app.post('/api/floating-chat/sessions/:id/media-result', (req, res) => {
    try {
      const session = getSession(db, req.params.id);
      if (!session) return res.status(404).json({ error: 'Chat tidak ditemukan.' });
      const jobId = String(req.body?.jobId || '').trim();
      if (!jobId) throw Object.assign(new Error('Job media tidak tersedia.'), { status: 422 });
      const row = db.prepare('SELECT * FROM ai_generations WHERE id=?').get(jobId);
      if (!row) throw Object.assign(new Error('Job media tidak ditemukan.'), { status: 404 });
      if (row.status !== 'Completed') throw Object.assign(new Error(`Job media belum selesai (${row.status}).`), { status: 409 });
      const metadata = (() => { try { return JSON.parse(row.metadata || '{}'); } catch (_) { return {}; } })();
      const media = (() => { try { return JSON.parse(row.media || '[]'); } catch (_) { return []; } })();
      const first = media[0] || {};
      const mediaType = row.media_type === 'video' ? 'video' : 'image';
      const assetId = String(metadata.generatedAssetId || first.assetId || '');
      const mediaUrl = String(metadata.resultUrl || first.url || (assetId && mediaType === 'image' ? `/api/assets/${encodeURIComponent(assetId)}/preview` : ''));
      if (!mediaUrl) throw Object.assign(new Error('Hasil media selesai tetapi file belum tersedia di Assets.'), { status: 409 });
      const content = String(req.body?.content || (mediaType === 'video' ? 'Video selesai dibuat dan otomatis tersimpan ke Assets.' : 'Gambar selesai dibuat dan otomatis tersimpan ke Assets.'));
      const result = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model,media_type,media_url,asset_id,job_id) VALUES(?,?,?,?,?,?,?,?,?)').run(session.id, 'assistant', content, row.provider, row.model, mediaType, mediaUrl, assetId || null, jobId);
      db.prepare('UPDATE floating_chat_sessions SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(session.id);
      res.status(201).json({ assistant: messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(result.lastInsertRowid)) });
    } catch (error) { sendError(res, error); }
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
      const assetIds = [...new Set((Array.isArray(req.body?.assetIds) ? req.body.assetIds : []).map(String).filter(Boolean))].slice(0, 8);
      const userResult = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model,attachments_json) VALUES(?,?,?,?,?,?)').run(session.id, 'user', content, provider.provider, model, JSON.stringify(assetIds));
      updateSessionFromUser(db, session, content, provider.provider, model);
      const history = db.prepare('SELECT role,content FROM floating_chat_messages WHERE session_id=? ORDER BY id DESC LIMIT ?').all(session.id, MAX_HISTORY_MESSAGES).reverse();
      const prompt = buildConversationPrompt(history);
      const result = await executeTextProvider(db, provider.provider, model, prompt, transport);
      const answer = String(result?.content || '').trim();
      if (!answer) throw Object.assign(new Error('Provider tidak mengembalikan jawaban.'), { status: 502 });
      const assistantResult = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model) VALUES(?,?,?,?,?)').run(session.id, 'assistant', answer, provider.provider, model);
      db.prepare('UPDATE floating_chat_sessions SET provider=?,model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(provider.provider, model, session.id);
      res.json({ session: sessionJson(getSession(db, session.id)), user: messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(userResult.lastInsertRowid)), assistant: messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(assistantResult.lastInsertRowid)) });
    } catch (error) { sendError(res, error); }
  });
}

module.exports = { install, ensureSchema, buildConversationPrompt, textProviders, executeTextProvider, sendError, messageJson };
