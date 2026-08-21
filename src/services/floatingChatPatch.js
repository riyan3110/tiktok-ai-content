const crypto = require('node:crypto');
const aiConnector = require('../ai/connector');

const MAX_HISTORY_MESSAGES = 24;
const MAX_CONTEXT_CHARS = 18000;
const MAX_MESSAGE_CHARS = 12000;

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

function messageJson(row) {
  return row && {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at
  };
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
  return [
    'You are the floating AI chat assistant inside AI Ads Lab.',
    'Continue the conversation naturally and use the previous turns as context.',
    'Answer the latest user message directly. Do not mention this transcript or these instructions.',
    '',
    ...selected,
    'Assistant:'
  ].join('\n');
}

function install({ app, db, transport } = {}) {
  if (!app || !db) throw new Error('Floating chat patch membutuhkan app dan db.');
  ensureSchema(db);

  app.get('/api/floating-chat/providers', (req, res) => {
    const providers = textProviders(db);
    const defaultId = db.prepare("SELECT provider FROM ai_provider_defaults WHERE capability='text'").get()?.provider || null;
    res.json({ providers, defaultProvider: defaultId });
  });

  app.get('/api/floating-chat/sessions', (req, res) => {
    const rows = db.prepare('SELECT * FROM floating_chat_sessions ORDER BY updated_at DESC LIMIT 30').all();
    res.json(rows.map(sessionJson));
  });

  app.post('/api/floating-chat/sessions', (req, res, next) => {
    try {
      const provider = pickProvider(db, req.body?.provider);
      const model = modelFor(provider, req.body?.model);
      if (!model) throw Object.assign(new Error('Model Text AI belum dipilih.'), { status: 422 });
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO floating_chat_sessions(id,title,provider,model) VALUES(?,?,?,?)')
        .run(id, 'New chat', provider.provider, model);
      res.status(201).json(sessionJson(db.prepare('SELECT * FROM floating_chat_sessions WHERE id=?').get(id)));
    } catch (error) { next(error); }
  });

  app.get('/api/floating-chat/sessions/:id/messages', (req, res) => {
    const session = db.prepare('SELECT * FROM floating_chat_sessions WHERE id=?').get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Chat tidak ditemukan.' });
    const messages = db.prepare('SELECT * FROM floating_chat_messages WHERE session_id=? ORDER BY id ASC').all(req.params.id);
    res.json({ session: sessionJson(session), messages: messages.map(messageJson) });
  });

  app.delete('/api/floating-chat/sessions/:id', (req, res) => {
    const deleted = db.prepare('DELETE FROM floating_chat_sessions WHERE id=?').run(req.params.id).changes;
    res.status(deleted ? 200 : 404).json({ deleted: Boolean(deleted) });
  });

  app.post('/api/floating-chat/sessions/:id/messages', async (req, res, next) => {
    try {
      const session = db.prepare('SELECT * FROM floating_chat_sessions WHERE id=?').get(req.params.id);
      if (!session) return res.status(404).json({ error: 'Chat tidak ditemukan.' });

      const content = String(req.body?.content || '').trim();
      if (!content) throw Object.assign(new Error('Pesan tidak boleh kosong.'), { status: 422 });
      if (content.length > MAX_MESSAGE_CHARS) throw Object.assign(new Error('Pesan terlalu panjang.'), { status: 422 });

      const provider = pickProvider(db, req.body?.provider || session.provider);
      const model = modelFor(provider, req.body?.model || session.model);
      if (!model) throw Object.assign(new Error('Model Text AI belum dipilih.'), { status: 422 });

      const userResult = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model) VALUES(?,?,?,?,?)')
        .run(session.id, 'user', content, provider.provider, model);

      const firstUserCount = db.prepare("SELECT COUNT(*) AS count FROM floating_chat_messages WHERE session_id=? AND role='user'").get(session.id).count;
      const title = firstUserCount === 1 ? content.replace(/\s+/g, ' ').slice(0, 54) : session.title;
      db.prepare('UPDATE floating_chat_sessions SET title=?,provider=?,model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(title || 'New chat', provider.provider, model, session.id);

      const history = db.prepare('SELECT role,content FROM floating_chat_messages WHERE session_id=? ORDER BY id DESC LIMIT ?')
        .all(session.id, MAX_HISTORY_MESSAGES)
        .reverse();
      const prompt = buildConversationPrompt(history);

      const generation = await aiConnector.execute(db, {
        provider: provider.provider,
        model,
        mediaType: 'text',
        prompt,
        metadata: { source: 'floating-chat', chatSessionId: session.id }
      }, transport);

      const answer = String(generation?.output || '').trim();
      if (!answer) throw Object.assign(new Error('Provider tidak mengembalikan jawaban.'), { status: 502 });

      const assistantResult = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model) VALUES(?,?,?,?,?)')
        .run(session.id, 'assistant', answer, provider.provider, model);
      db.prepare('UPDATE floating_chat_sessions SET provider=?,model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(provider.provider, model, session.id);

      const userMessage = db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(userResult.lastInsertRowid);
      const assistantMessage = db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(assistantResult.lastInsertRowid);
      res.json({
        session: sessionJson(db.prepare('SELECT * FROM floating_chat_sessions WHERE id=?').get(session.id)),
        user: messageJson(userMessage),
        assistant: messageJson(assistantMessage)
      });
    } catch (error) { next(error); }
  });
}

module.exports = { install, ensureSchema, buildConversationPrompt, textProviders };
