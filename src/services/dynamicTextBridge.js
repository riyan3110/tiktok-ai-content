const crypto = require('node:crypto');
const { StorageService } = require('../storage/service');
const sourceFetcher = require('./sourceFetcher');
const floatingChat = require('./floatingChatPatch');
const webSearch = require('./webSearchProviders');

const MAX_HISTORY_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 12000;
const MAX_VISION_IMAGES = 4;
const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;

function extractUrls(text = '') {
  const matches = String(text).match(/https?:\/\/[^\s<>()\[\]{}"']+/gi) || [];
  return [...new Set(matches.map(value => value.replace(/[.,!?;:]+$/, '')))].slice(0, 3);
}

// AI Chat has web search permanently ON (no toggle). For every message:
//  - if the user pasted URLs, read those pages;
//  - otherwise always run the web-search router (force mode) so the AI answers
//    from fresh, cited sources instead of saying it has no web access.
// Returns { context, citations }.
async function sourceContextFor(db, content, transport) {
  const urls = extractUrls(content);
  if (urls.length) {
    try {
      const sources = await sourceFetcher.fetchSources(urls, transport ? { fetchImpl: transport } : {});
      return { context: sourceFetcher.buildSourceContext(sources), citations: [] };
    } catch (error) {
      return { context: `<SOURCE_ERROR>${String(error?.message || 'URL tidak dapat dibaca').slice(0, 500)}</SOURCE_ERROR>`, citations: [] };
    }
  }
  // No URL -> always search the web (force=true inside webSearchContextFor).
  try {
    return await floatingChat.webSearchContextFor(db, content, transport);
  } catch (error) {
    return { context: `<SEARCH_ERROR>${String(error?.message || 'Pencarian gagal').slice(0, 300)}</SEARCH_ERROR>`, citations: [] };
  }
}

async function prepareVisionParts(storage, assetIds = []) {
  const ids = [...new Set((Array.isArray(assetIds) ? assetIds : []).map(String).filter(Boolean))].slice(0, MAX_VISION_IMAGES);
  const parts = [];
  for (const id of ids) {
    const asset = storage.repository.get(id);
    if (!asset) throw Object.assign(new Error(`Asset tidak ditemukan: ${id}`), { status: 404 });
    const preview = await storage.preview(asset);
    if (!String(preview.mimeType || '').startsWith('image/')) throw Object.assign(new Error('Attachment AI Chat harus berupa gambar.'), { status: 422 });
    if (preview.data.length > MAX_VISION_IMAGE_BYTES) throw Object.assign(new Error('Ukuran gambar maksimal 8 MB per gambar.'), { status: 413 });
    parts.push({ type: 'image_url', image_url: { url: `data:${preview.mimeType};base64,${preview.data.toString('base64')}` } });
  }
  return { ids, parts };
}

function sessionJson(row) {
  return row && {
    id: row.id,
    title: row.title,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sharedTextDefault: true
  };
}

function binding(dynamicAi, db) {
  const current = dynamicAi.publicState(db);
  const providerId = current.defaults?.text?.providerId;
  const provider = current.providers.find(item => item.id === providerId);
  const model = current.defaults?.text?.model;
  if (!provider || !model) throw Object.assign(new Error('Default Text AI belum dipilih. Atur Provider dan Model pada halaman Provider AI.'), { status: 409 });
  return { provider, model };
}

function installContentBridge({ db, content, dynamicAi, transport }) {
  if (!content || content.__AIADS_DYNAMIC_TEXT_BRIDGE__) return;
  Object.defineProperty(content, '__AIADS_DYNAMIC_TEXT_BRIDGE__', { value: true, enumerable: false });

  if (typeof content.generateContent === 'function') {
    const original = content.generateContent.bind(content);
    content.generateContent = (previousTopics, options = {}, client) => {
      if (client) return original(previousTopics, options, client);
      return original(previousTopics, options, require('./textProviderRuntime').client());
    };
  }

  if (typeof content.generateAngles === 'function') {
    const original = content.generateAngles.bind(content);
    content.generateAngles = (mainTopic, count, options = {}, client) => {
      if (client) return original(mainTopic, count, options, client);
      return original(mainTopic, count, options, require('./textProviderRuntime').client());
    };
  }
}

function installChatBridge({ app, db, dynamicAi, transport }) {
  const storage = new StorageService({ db });

  app.get('/api/floating-chat/providers', (req, res) => {
    try {
      const { provider, model } = binding(dynamicAi, db);
      res.json({
        providers: [{
          provider: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          textModel: model,
          defaultModel: model,
          capabilities: ['text'],
          enabled: true,
          hasApiKey: provider.hasApiKey
        }],
        defaultProvider: provider.id,
        sharedTextDefault: true
      });
    } catch (error) { floatingChat.sendError(res, error); }
  });

  app.get('/api/floating-chat/providers/:provider/models', (req, res) => {
    try {
      const { provider, model } = binding(dynamicAi, db);
      if (req.params.provider !== provider.id) throw Object.assign(new Error('AI Chat mengikuti Default Text AI. Pilih provider dari halaman Provider AI.'), { status: 409 });
      res.json({ provider: provider.id, models: provider.models || [model], selectedModel: model, sharedTextDefault: true });
    } catch (error) { floatingChat.sendError(res, error); }
  });

  app.post('/api/floating-chat/sessions', (req, res) => {
    try {
      const { provider, model } = binding(dynamicAi, db);
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO floating_chat_sessions(id,title,provider,model) VALUES(?,?,?,?)').run(id, 'New chat', provider.id, model);
      res.status(201).json(sessionJson(db.prepare('SELECT * FROM floating_chat_sessions WHERE id=?').get(id)));
    } catch (error) { floatingChat.sendError(res, error); }
  });

  app.post('/api/floating-chat/sessions/:id/messages', async (req, res) => {
    try {
      const session = db.prepare('SELECT * FROM floating_chat_sessions WHERE id=?').get(req.params.id);
      if (!session) return res.status(404).json({ error: 'Chat tidak ditemukan.' });
      const content = String(req.body?.content || '').trim();
      if (!content) throw Object.assign(new Error('Pesan tidak boleh kosong.'), { status: 422 });
      if (content.length > MAX_MESSAGE_CHARS) throw Object.assign(new Error('Pesan terlalu panjang.'), { status: 422 });

      const { provider, model } = binding(dynamicAi, db);
      const prepared = await prepareVisionParts(storage, req.body?.assetIds);
      const userResult = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model,attachments_json) VALUES(?,?,?,?,?,?)')
        .run(session.id, 'user', content, provider.id, model, JSON.stringify(prepared.ids));

      const userCount = db.prepare("SELECT COUNT(*) AS count FROM floating_chat_messages WHERE session_id=? AND role='user'").get(session.id).count;
      const title = userCount === 1 ? content.replace(/\s+/g, ' ').slice(0, 54) : session.title;
      db.prepare('UPDATE floating_chat_sessions SET title=?,provider=?,model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(title || 'New chat', provider.id, model, session.id);

      const history = db.prepare('SELECT role,content FROM floating_chat_messages WHERE session_id=? ORDER BY id DESC LIMIT ?')
        .all(session.id, MAX_HISTORY_MESSAGES).reverse();
      const { context: sourceContext, citations: searchCitations = [] } = await sourceContextFor(db, content, transport);
      const messages = floatingChat.buildConversationMessages(history, sourceContext);
      if (prepared.parts.length) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index].role !== 'user') continue;
          messages[index] = {
            ...messages[index],
            content: [{ type: 'text', text: String(messages[index].content || '') }, ...prepared.parts]
          };
          break;
        }
      }

      const result = await dynamicAi.executeMessages(db, messages, transport);
      const answer = String(result?.text || '').trim();
      if (!answer) throw Object.assign(new Error('Provider tidak mengembalikan jawaban.'), { status: 502 });

      const assistantResult = db.prepare('INSERT INTO floating_chat_messages(session_id,role,content,provider,model) VALUES(?,?,?,?,?)')
        .run(session.id, 'assistant', answer, result.providerId || provider.id, result.model || model);
      db.prepare('UPDATE floating_chat_sessions SET provider=?,model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(result.providerId || provider.id, result.model || model, session.id);

      res.json({
        aiMetadata: { provider: result.provider, providerId: result.providerId, model: result.model, responseTime: result.responseTime },
        session: sessionJson(db.prepare('SELECT * FROM floating_chat_sessions WHERE id=?').get(session.id)),
        user: floatingChat.messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(userResult.lastInsertRowid)),
        assistant: floatingChat.messageJson(db.prepare('SELECT * FROM floating_chat_messages WHERE id=?').get(assistantResult.lastInsertRowid)),
        citations: searchCitations
      });
    } catch (error) { floatingChat.sendError(res, error); }
  });
}

function install({ app, db, content, dynamicAi, transport } = {}) {
  if (!app || !db || !content || !dynamicAi) throw new Error('Dynamic Text bridge membutuhkan app, db, content, dan dynamicAi.');
  require('./textProviderRuntime').bind(db, transport);
  installContentBridge({ db, content, dynamicAi, transport });
  installChatBridge({ app, db, dynamicAi, transport });
}

module.exports = { install, sourceContextFor };
