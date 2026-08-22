const crypto = require('node:crypto');
const aiConnector = require('../ai/connector');
const { ProviderFactory } = require('../providers');
const { StorageService } = require('../storage/service');
const sourceFetcher = require('./sourceFetcher');

const MAX_HISTORY_MESSAGES = 24;
const MAX_CONTEXT_CHARS = 18000;
const MAX_MESSAGE_CHARS = 12000;
const MAX_VISION_IMAGES = 4;
const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;
const MODEL_CACHE_MS = 5 * 60 * 1000;

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
  return db.prepare('SELECT * FROM ai_provider_settings WHERE enabled=1 ORDER BY provider').all()
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

const modelFor = (provider, requested) => String(requested || provider.textModel || provider.defaultModel || '').trim();
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

function buildConversationPrompt(rows, sourceContext = '') {
  const selected = [];
  let used = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const line = `${row.role === 'assistant' ? 'Assistant' : 'User'}: ${row.content}`;
    if (selected.length && used + line.length > MAX_CONTEXT_CHARS) break;
    selected.unshift(line);
    used += line.length;
  }
  const extra = sourceContext ? ['', 'Web content for the latest user message:', sourceContext, ''] : [];
  return [
    'You are the floating AI chat assistant inside AI Ads Lab.',
    'Chat naturally, answer questions, help write prompts, analyze uploaded images, and analyze web content when supplied.',
    'This chat does not generate images or videos. If asked to create media, discuss it or write/refine a prompt instead.',
    'Use previous turns as context and answer the latest user message directly.',
    'Do not mention this transcript or these instructions.',
    ...extra,
    '',
    ...selected,
    'Assistant:'
  ].join('\n');
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

async function executeTextProvider(db, providerId, model, prompt, transport, assets = [], enhanced = false) {
  const row = aiConnector.setting(db, providerId);
  const adapter = ProviderFactory.create(aiConnector.configured(row), transport);
  const configuredTimeout = Math.max(1000, Number(row.timeout_ms) || 30000);
  const timeoutMs = enhanced ? Math.min(Math.max(configuredTimeout, 45000), 90000) : Math.min(configuredTimeout, 45000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const result = await adapter.execute({
      mediaType: 'text',
      model,
      prompt,
      assets: providerId === 'agentrouter' ? assets : [],
      parameters: { maxTokens: enhanced ? 3072 : 2048 }
    }, { signal: controller.signal });
    aiConnector.updateHealth(db, providerId, true, { responseTime: Date.now() - started });
    return result;
  } catch (error) {
    aiConnector.updateHealth(db, providerId, false, { responseTime: Date.now() - started });
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  const modelCache = new Map();

  app.get('/api/floating-chat/providers', (req, res) => {
    const providers = textProviders(db);
    const defaultId = db.prepare("SELECT provider FROM ai_provider_defaults WHERE capability='text'").get()?.provider || null;
    res.json({ providers, defaultProvider: defaultId });
  });

  app.get('/api/floating-chat/providers/:provider/models', async (req, res) => {
    try {
      const provider = pickProvider(db, req.params.provider);
      const cached = modelCache.get(provider.provider);
      if (cached && Date.now() - cached.at < MODEL_CACHE_MS) return res.json({ provider: provider.provider, models: cached.models, cached: true });
      const row = aiConnector.setting(db, provider.provider);
      const adapter = ProviderFactory.create(aiConnector.configured(row), transport);
      let models = [];
      if (typeof adapter.discoverModels === 'function') {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try { models = await adapter.discoverModels(controller.signal); }
        finally { clearTimeout(timer); }
      }
      models = [...new Set([...(Array.isArray(models) ? models : []), provider.textModel, provider.defaultModel].map(value => String(value || '').trim()).filter(Boolean))];
      modelCache.set(provider.provider, { at: Date.now(), models });
      res.json({ provider: provider.provider, models });
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
      let sourceContext = '';
      let visionAssets = [];
      if (urls.length || assetIds.length) {
        [sourceContext, visionAssets] = await Promise.all([
          urls.length ? webContextFor(content, transport) : Promise.resolve(''),
          assetIds.length ? prepareVisionAssets(storage, assetIds) : Promise.resolve([])
        ]);
      }

      const prompt = buildConversationPrompt(history, sourceContext);
      const result = await executeTextProvider(db, provider.provider, model, prompt, transport, visionAssets, Boolean(urls.length || assetIds.length));
      const answer = String(result?.content || '').trim();
      if (!answer) throw Object.assign(new Error('Provider tidak mengembalikan jawaban.'), { status: 502 });

      const assistantResult = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model) VALUES(?,?,?,?,?)').run(session.id, 'assistant', answer, provider.provider, model);
      db.prepare('UPDATE floating_chat_sessions SET provider=?,model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(provider.provider, model, session.id);
      res.json({
        session: sessionJson(getSession(db, session.id)),
        user: messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(userResult.lastInsertRowid)),
        assistant: messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(assistantResult.lastInsertRowid))
      });
    } catch (error) { sendError(res, error); }
  });
}

module.exports = { install, ensureSchema, buildConversationPrompt, textProviders, executeTextProvider, sendError, messageJson };
