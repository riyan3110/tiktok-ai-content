const crypto = require('node:crypto');
const config = require('../config');

const cipherKey = crypto.createHash('sha256').update(config.sessionSecret).digest();
const ROLES = new Set(['text', 'image']);
const DISPLAY_NAMES = Object.freeze({
  '9router': '9Router',
  orcarouter: 'OrcaRouter',
  agentrouter: 'BluesMinds'
});

function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey, iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
}

function decrypt(value) {
  if (!value) return '';
  const [iv, tag, data] = String(value).split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function normalizeRole(raw, fallback = 'text') {
  const role = String(raw || fallback).toLowerCase();
  if (!ROLES.has(role)) throw Object.assign(new Error('Role provider hanya boleh text atau image.'), { status: 422 });
  return role;
}

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Base URL tidak valid.'), { status: 422 }); }
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error('Base URL harus memakai http:// atau https://.'), { status: 422 });
  return value;
}

function inferName(baseUrl) {
  const url = new URL(baseUrl);
  const host = url.hostname.toLowerCase();
  const exact = [
    [/api\.b\.ai$/, 'B.AI'],
    [/openrouter\.ai$/, 'OpenRouter'],
    [/orcarouter\.ai$/, 'OrcaRouter'],
    [/bluesminds\.com$/, 'BluesMinds'],
    [/vyceai\.com$/, 'VyceAI'],
    [/seekai\.cc$/, 'SeekAI'],
    [/anymodel\.org$/, 'Anymodel']
  ].find(([pattern]) => pattern.test(host));
  if (exact) return exact[1];
  if (host === '43.159.50.231' && url.port === '20130') return '9Router';
  const first = host.replace(/^api\./, '').split('.')[0] || 'Provider';
  return first.replace(/[-_]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

function providerId(baseUrl) {
  return `custom-${crypto.createHash('sha1').update(baseUrl).digest('hex').slice(0, 12)}`;
}

function join(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function ensureColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_dynamic_provider_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL UNIQUE,
      api_key_encrypted TEXT NOT NULL,
      selected_model TEXT,
      selected_text_model TEXT,
      selected_image_model TEXT,
      models_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_dynamic_provider_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      selected_provider_id TEXT,
      selected_text_provider_id TEXT,
      selected_image_provider_id TEXT,
      fallback_enabled INTEGER NOT NULL DEFAULT 0,
      migration_done INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO ai_dynamic_provider_state(id) VALUES(1);
  `);
  ensureColumn(db, 'ai_dynamic_provider_profiles', 'selected_text_model', 'TEXT');
  ensureColumn(db, 'ai_dynamic_provider_profiles', 'selected_image_model', 'TEXT');
  ensureColumn(db, 'ai_dynamic_provider_state', 'selected_text_provider_id', 'TEXT');
  ensureColumn(db, 'ai_dynamic_provider_state', 'selected_image_provider_id', 'TEXT');
  db.prepare('UPDATE ai_dynamic_provider_profiles SET selected_text_model=COALESCE(selected_text_model,selected_model), selected_image_model=COALESCE(selected_image_model,selected_model)').run();
  db.prepare('UPDATE ai_dynamic_provider_state SET selected_text_provider_id=COALESCE(selected_text_provider_id,selected_provider_id)').run();
}

function safeModels(raw) {
  try { const parsed = JSON.parse(raw || '[]'); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; }
  catch { return []; }
}

function state(db) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM ai_dynamic_provider_state WHERE id=1').get();
}

function roleModel(row, role) {
  return String(role === 'image' ? row?.selected_image_model : row?.selected_text_model || row?.selected_model || '').trim();
}

function profiles(db) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM ai_dynamic_provider_profiles ORDER BY created_at,id').all().map(row => ({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: roleModel(row, 'text'),
    textModel: roleModel(row, 'text'),
    imageModel: roleModel(row, 'image'),
    models: safeModels(row.models_json),
    hasApiKey: Boolean(row.api_key_encrypted),
    updatedAt: row.updated_at
  }));
}

function legacyDefaultDynamicId(db, role) {
  try {
    const legacy = db.prepare('SELECT provider FROM ai_provider_defaults WHERE capability=?').get(role)?.provider;
    if (!legacy) return null;
    const row = db.prepare('SELECT base_url FROM ai_provider_settings WHERE provider=?').get(legacy);
    if (!row?.base_url) return null;
    const normalized = String(row.base_url).replace(/\/+$/, '');
    return db.prepare('SELECT id FROM ai_dynamic_provider_profiles WHERE base_url=?').get(normalized)?.id || null;
  } catch (_) { return null; }
}

function seedRoleDefaults(db) {
  const current = state(db);
  const first = db.prepare('SELECT id FROM ai_dynamic_provider_profiles ORDER BY created_at,id LIMIT 1').get()?.id || null;
  const textId = current.selected_text_provider_id || legacyDefaultDynamicId(db, 'text') || current.selected_provider_id || first;
  const imageId = current.selected_image_provider_id || legacyDefaultDynamicId(db, 'image') || first;
  db.prepare('UPDATE ai_dynamic_provider_state SET selected_provider_id=?,selected_text_provider_id=?,selected_image_provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1')
    .run(textId, textId, imageId);
}

function migrateExistingProviders(db) {
  ensureSchema(db);
  const current = state(db);
  if (!current.migration_done) {
    const rows = db.prepare("SELECT * FROM ai_provider_settings WHERE provider IN ('9router','orcarouter','agentrouter') AND api_key_encrypted IS NOT NULL AND TRIM(api_key_encrypted)<>''").all();
    const insert = db.prepare(`INSERT OR IGNORE INTO ai_dynamic_provider_profiles(id,name,base_url,api_key_encrypted,selected_model,selected_text_model,selected_image_model,models_json)
      VALUES(?,?,?,?,?,?,?,?)`);
    for (const row of rows) {
      const baseUrl = String(row.base_url || '').replace(/\/+$/, '');
      if (!baseUrl) continue;
      const textModel = row.text_model || row.default_model || '';
      const imageModel = row.image_model || row.default_model || textModel || '';
      const modelList = [...new Set([row.text_model, row.image_model, row.default_model].filter(Boolean))];
      insert.run(providerId(baseUrl), DISPLAY_NAMES[row.provider] || inferName(baseUrl), baseUrl, row.api_key_encrypted, textModel, textModel, imageModel, JSON.stringify(modelList));
    }
    db.prepare('UPDATE ai_dynamic_provider_state SET migration_done=1,updated_at=CURRENT_TIMESTAMP WHERE id=1').run();
  }
  // Recover separate defaults even for databases that were migrated by the older one-default implementation.
  try {
    const legacyRows = db.prepare("SELECT * FROM ai_provider_settings WHERE provider IN ('9router','orcarouter','agentrouter')").all();
    for (const legacy of legacyRows) {
      const baseUrl = String(legacy.base_url || '').replace(/\/+$/, '');
      const dynamic = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE base_url=?').get(baseUrl);
      if (!dynamic) continue;
      const textModel = legacy.text_model || dynamic.selected_text_model || dynamic.selected_model;
      const imageModel = legacy.image_model || dynamic.selected_image_model || dynamic.selected_model;
      db.prepare('UPDATE ai_dynamic_provider_profiles SET selected_text_model=COALESCE(selected_text_model,?),selected_image_model=COALESCE(selected_image_model,?) WHERE id=?')
        .run(textModel || null, imageModel || null, dynamic.id);
    }
  } catch (_) {}
  seedRoleDefaults(db);
}

function selectedProfile(db, role = 'text') {
  role = normalizeRole(role);
  migrateExistingProviders(db);
  const current = state(db);
  const id = role === 'image' ? current.selected_image_provider_id : current.selected_text_provider_id;
  const all = db.prepare('SELECT * FROM ai_dynamic_provider_profiles ORDER BY created_at,id').all();
  return all.find(row => row.id === id) || all[0] || null;
}

function authHeaders(apiKey) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

function modelIds(payload) {
  const candidates = [payload?.data, payload?.models, payload?.result?.data, payload?.result?.models, payload?.items];
  const list = candidates.find(Array.isArray) || [];
  return [...new Set(list.map(item => typeof item === 'string' ? item : item?.id || item?.name || item?.model).map(value => String(value || '').trim()).filter(Boolean))];
}

async function fetchModels(baseUrl, apiKey, transport = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await transport(join(baseUrl, 'models'), { headers: authHeaders(apiKey), signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw Object.assign(new Error(text || `HTTP ${response.status}`), { status: response.status });
    let payload;
    try { payload = JSON.parse(text); } catch { throw Object.assign(new Error('Daftar model dari provider bukan JSON yang valid.'), { status: 502 }); }
    const models = modelIds(payload);
    if (!models.length) throw Object.assign(new Error('Provider terhubung, tetapi daftar model kosong/tidak dikenali.'), { status: 422 });
    return models;
  } finally { clearTimeout(timer); }
}

function textFromChat(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('').trim();
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  const output = payload?.output;
  if (Array.isArray(output)) return output.flatMap(item => item?.content || []).map(part => part?.text || part?.value || '').join('').trim();
  return String(payload?.text || payload?.response || '').trim();
}

function messagesToPrompt(messages) {
  return (Array.isArray(messages) ? messages : []).map(message => {
    const content = Array.isArray(message?.content)
      ? message.content.map(part => part?.text || '').filter(Boolean).join(' ')
      : String(message?.content || '');
    return `${message?.role || 'user'}: ${content}`;
  }).join('\n\n');
}

async function callTextProvider(row, request, transport = fetch) {
  const apiKey = decrypt(row.api_key_encrypted);
  const model = roleModel(row, 'text') || safeModels(row.models_json)[0];
  if (!model) throw new Error(`${row.name}: belum ada model Text AI yang dipilih.`);
  const messages = Array.isArray(request?.messages) && request.messages.length
    ? request.messages
    : [{ role: 'user', content: String(request?.prompt || '') }];
  const prompt = String(request?.prompt || messagesToPrompt(messages)).trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    let response = await transport(join(row.base_url, 'chat/completions'), {
      method: 'POST', headers: authHeaders(apiKey), signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(request?.responseFormat ? { response_format: request.responseFormat } : {}),
        ...(Number.isFinite(request?.temperature) ? { temperature: request.temperature } : {})
      })
    });
    let raw = await response.text();
    if (!response.ok && [404, 405].includes(response.status)) {
      response = await transport(join(row.base_url, 'responses'), {
        method: 'POST', headers: authHeaders(apiKey), signal: controller.signal,
        body: JSON.stringify({ model, input: prompt })
      });
      raw = await response.text();
    }
    if (!response.ok) throw Object.assign(new Error(raw || `HTTP ${response.status}`), { status: response.status });
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { throw new Error('Provider mengembalikan response non-JSON.'); }
    const text = textFromChat(payload);
    if (!text) throw new Error('Provider merespons tetapi tidak mengembalikan teks.');
    const usage = payload.usage || {};
    return {
      text, provider: row.name, providerId: row.id, model,
      usage: {
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0
      }
    };
  } finally { clearTimeout(timer); }
}

async function callImageProvider(row, prompt, options = {}, transport = fetch) {
  const apiKey = decrypt(row.api_key_encrypted);
  const model = roleModel(row, 'image') || safeModels(row.models_json)[0];
  if (!model) throw new Error(`${row.name}: belum ada model Image AI yang dipilih.`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const body = {
      model,
      prompt,
      n: 1,
      ...(options.size ? { size: options.size } : {}),
      ...(options.responseFormat ? { response_format: options.responseFormat } : {})
    };
    const response = await transport(join(row.base_url, 'images/generations'), {
      method: 'POST', headers: authHeaders(apiKey), signal: controller.signal, body: JSON.stringify(body)
    });
    const raw = await response.text();
    if (!response.ok) throw Object.assign(new Error(raw || `HTTP ${response.status}`), { status: response.status });
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { throw new Error('Provider image mengembalikan response non-JSON.'); }
    const item = payload?.data?.[0] || payload?.result?.data?.[0] || payload?.result || payload;
    const url = item?.url || item?.image_url || item?.output_url || null;
    const b64Json = item?.b64_json || item?.base64 || null;
    if (!url && !b64Json) throw new Error('Provider image merespons tetapi tidak mengembalikan URL/base64 gambar.');
    return { provider: row.name, providerId: row.id, model, url, b64Json, revisedPrompt: item?.revised_prompt || null };
  } finally { clearTimeout(timer); }
}

function orderedRows(db, role = 'text') {
  role = normalizeRole(role);
  migrateExistingProviders(db);
  const all = db.prepare('SELECT * FROM ai_dynamic_provider_profiles ORDER BY created_at,id').all();
  if (!all.length) return [];
  const current = state(db);
  const selectedId = role === 'image' ? current.selected_image_provider_id : current.selected_text_provider_id;
  const selected = all.find(row => row.id === selectedId) || all[0];
  if (!current.fallback_enabled) return [selected];
  return [selected, ...all.filter(row => row.id !== selected.id)];
}

async function executeMessages(db, messages, transport = fetch, options = {}) {
  const rows = orderedRows(db, 'text');
  if (!rows.length) throw Object.assign(new Error('Belum ada provider Text AI yang tersimpan.'), { status: 409 });
  let lastError;
  for (const row of rows) {
    try { return await callTextProvider(row, { ...options, messages }, transport); }
    catch (error) {
      lastError = new Error(`${row.name}: ${error.message || 'Provider gagal merespons.'}`);
      if (!state(db).fallback_enabled) break;
    }
  }
  throw Object.assign(lastError || new Error('Semua provider Text AI gagal.'), { status: 502 });
}

async function execute(db, prompt, transport = fetch, options = {}) {
  const value = String(prompt || '').trim();
  if (!value) throw Object.assign(new Error('Prompt wajib diisi.'), { status: 422 });
  return executeMessages(db, [{ role: 'user', content: value }], transport, { ...options, prompt: value });
}

async function executeImage(db, prompt, options = {}, transport = fetch) {
  const value = String(prompt || '').trim();
  if (!value) throw Object.assign(new Error('Prompt gambar wajib diisi.'), { status: 422 });
  const rows = orderedRows(db, 'image');
  if (!rows.length) throw Object.assign(new Error('Belum ada provider Image AI yang tersimpan.'), { status: 409 });
  let lastError;
  for (const row of rows) {
    try { return await callImageProvider(row, value, options, transport); }
    catch (error) {
      lastError = new Error(`${row.name}: ${error.message || 'Provider image gagal merespons.'}`);
      if (!state(db).fallback_enabled) break;
    }
  }
  throw Object.assign(lastError || new Error('Semua provider Image AI gagal.'), { status: 502 });
}

function publicState(db) {
  migrateExistingProviders(db);
  const current = state(db);
  const all = profiles(db);
  const text = all.find(item => item.id === current.selected_text_provider_id) || all[0] || null;
  const image = all.find(item => item.id === current.selected_image_provider_id) || all[0] || null;
  return {
    providers: all,
    selectedProviderId: text?.id || null,
    defaults: {
      text: { providerId: text?.id || null, model: text?.textModel || null },
      image: { providerId: image?.id || null, model: image?.imageModel || null }
    },
    fallbackEnabled: Boolean(current.fallback_enabled)
  };
}

function setDefault(db, role, providerIdValue, modelValue) {
  role = normalizeRole(role);
  const row = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(providerIdValue);
  if (!row) throw Object.assign(new Error('Provider tidak ditemukan.'), { status: 404 });
  const models = safeModels(row.models_json);
  const model = String(modelValue || roleModel(row, role) || models[0] || '').trim();
  if (!model || !models.includes(model)) throw Object.assign(new Error('Model tidak tersedia pada provider ini.'), { status: 422 });
  const providerColumn = role === 'image' ? 'selected_image_provider_id' : 'selected_text_provider_id';
  const modelColumn = role === 'image' ? 'selected_image_model' : 'selected_text_model';
  db.prepare(`UPDATE ai_dynamic_provider_profiles SET ${modelColumn}=?,selected_model=CASE WHEN ?='text' THEN ? ELSE selected_model END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(model, role, model, row.id);
  db.prepare(`UPDATE ai_dynamic_provider_state SET ${providerColumn}=?,selected_provider_id=CASE WHEN ?='text' THEN ? ELSE selected_provider_id END,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
    .run(row.id, role, row.id);
  return publicState(db);
}

function createTextClient(db, transport = fetch) {
  return {
    chat: {
      completions: {
        create: async payload => {
          const result = await executeMessages(db, payload?.messages || [], transport, {
            responseFormat: payload?.response_format,
            temperature: payload?.temperature
          });
          return {
            choices: [{ message: { role: 'assistant', content: result.text } }],
            usage: {
              prompt_tokens: result.usage?.promptTokens || 0,
              completion_tokens: result.usage?.completionTokens || 0,
              total_tokens: result.usage?.totalTokens || 0
            },
            provider: result.provider,
            model: result.model
          };
        }
      }
    }
  };
}

function install({ app, db, transport = fetch }) {
  ensureSchema(db);
  migrateExistingProviders(db);

  app.get('/api/dynamic-ai/providers', (req, res) => res.json(publicState(db)));

  app.post('/api/dynamic-ai/providers', async (req, res, next) => {
    try {
      const role = normalizeRole(req.body?.role || 'text');
      const baseUrl = normalizeBaseUrl(req.body?.baseUrl);
      const apiKey = String(req.body?.apiKey || '').trim();
      if (!apiKey) throw Object.assign(new Error('API Key wajib diisi.'), { status: 422 });
      const models = await fetchModels(baseUrl, apiKey, transport);
      const id = providerId(baseUrl);
      const existing = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=? OR base_url=?').get(id, baseUrl);
      const name = existing?.name || inferName(baseUrl);
      const textModel = models.includes(existing?.selected_text_model) ? existing.selected_text_model : models[0];
      const imageModel = models.includes(existing?.selected_image_model) ? existing.selected_image_model : models[0];
      db.prepare(`INSERT INTO ai_dynamic_provider_profiles(id,name,base_url,api_key_encrypted,selected_model,selected_text_model,selected_image_model,models_json,updated_at)
        VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,api_key_encrypted=excluded.api_key_encrypted,selected_model=excluded.selected_model,selected_text_model=excluded.selected_text_model,selected_image_model=excluded.selected_image_model,models_json=excluded.models_json,updated_at=CURRENT_TIMESTAMP`)
        .run(id, name, baseUrl, encrypt(apiKey), textModel, textModel, imageModel, JSON.stringify(models));
      setDefault(db, role, id, role === 'image' ? imageModel : textModel);
      res.status(existing ? 200 : 201).json({ ...publicState(db), saved: { id, name, role, textModel, imageModel, models } });
    } catch (error) { next(error); }
  });

  app.put('/api/dynamic-ai/defaults/:role', (req, res, next) => {
    try { res.json(setDefault(db, req.params.role, req.body?.providerId, req.body?.model)); }
    catch (error) { next(error); }
  });

  // Backward-compatible text routes used by older clients.
  app.post('/api/dynamic-ai/providers/:id/select', (req, res, next) => {
    try { res.json(setDefault(db, 'text', req.params.id, req.body?.model)); }
    catch (error) { next(error); }
  });

  app.post('/api/dynamic-ai/providers/:id/model', (req, res, next) => {
    try { res.json(setDefault(db, 'text', req.params.id, req.body?.model)); }
    catch (error) { next(error); }
  });

  app.post('/api/dynamic-ai/providers/:id/refresh-models', async (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(req.params.id);
      if (!row) throw Object.assign(new Error('Provider tidak ditemukan.'), { status: 404 });
      const models = await fetchModels(row.base_url, decrypt(row.api_key_encrypted), transport);
      const textModel = models.includes(row.selected_text_model) ? row.selected_text_model : models[0];
      const imageModel = models.includes(row.selected_image_model) ? row.selected_image_model : models[0];
      db.prepare('UPDATE ai_dynamic_provider_profiles SET selected_model=?,selected_text_model=?,selected_image_model=?,models_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(textModel, textModel, imageModel, JSON.stringify(models), row.id);
      res.json({ ...publicState(db), models });
    } catch (error) { next(error); }
  });

  app.delete('/api/dynamic-ai/providers/:id', (req, res, next) => {
    try {
      const before = state(db);
      const removed = db.prepare('DELETE FROM ai_dynamic_provider_profiles WHERE id=?').run(req.params.id).changes;
      if (!removed) throw Object.assign(new Error('Provider tidak ditemukan.'), { status: 404 });
      const replacement = db.prepare('SELECT id FROM ai_dynamic_provider_profiles ORDER BY created_at,id LIMIT 1').get()?.id || null;
      const textId = before.selected_text_provider_id === req.params.id ? replacement : before.selected_text_provider_id;
      const imageId = before.selected_image_provider_id === req.params.id ? replacement : before.selected_image_provider_id;
      db.prepare('UPDATE ai_dynamic_provider_state SET selected_provider_id=?,selected_text_provider_id=?,selected_image_provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1')
        .run(textId, textId, imageId);
      res.json(publicState(db));
    } catch (error) { next(error); }
  });

  app.put('/api/dynamic-ai/fallback', (req, res) => {
    db.prepare('UPDATE ai_dynamic_provider_state SET fallback_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(Number(Boolean(req.body?.enabled)));
    res.json(publicState(db));
  });

  app.post('/api/dynamic-ai/generate', async (req, res, next) => {
    try {
      const started = Date.now();
      const result = await execute(db, req.body?.prompt, transport);
      res.json({ ...result, responseTime: Date.now() - started });
    } catch (error) { next(error); }
  });

  app.post('/api/dynamic-ai/generate-image', async (req, res, next) => {
    try {
      const started = Date.now();
      const result = await executeImage(db, req.body?.prompt, { size: req.body?.size, responseFormat: req.body?.responseFormat }, transport);
      res.json({ ...result, responseTime: Date.now() - started });
    } catch (error) { next(error); }
  });
}

module.exports = {
  install,
  execute,
  executeMessages,
  executeImage,
  createTextClient,
  publicState,
  selectedProfile,
  fetchModels,
  inferName,
  normalizeBaseUrl
};
