const crypto = require('node:crypto');
const config = require('../config');

const cipherKey = crypto.createHash('sha256').update(config.sessionSecret).digest();
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

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_dynamic_provider_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL UNIQUE,
      api_key_encrypted TEXT NOT NULL,
      selected_model TEXT,
      models_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ai_dynamic_provider_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      selected_provider_id TEXT,
      fallback_enabled INTEGER NOT NULL DEFAULT 0,
      migration_done INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO ai_dynamic_provider_state(id) VALUES(1);
  `);
}

function state(db) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM ai_dynamic_provider_state WHERE id=1').get();
}

function profiles(db) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM ai_dynamic_provider_profiles ORDER BY created_at,id').all().map(row => ({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.selected_model,
    models: safeModels(row.models_json),
    hasApiKey: Boolean(row.api_key_encrypted),
    updatedAt: row.updated_at
  }));
}

function safeModels(raw) {
  try { const parsed = JSON.parse(raw || '[]'); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; }
  catch { return []; }
}

function selectedProfile(db) {
  const current = state(db);
  const all = db.prepare('SELECT * FROM ai_dynamic_provider_profiles ORDER BY created_at,id').all();
  return all.find(row => row.id === current.selected_provider_id) || all[0] || null;
}

function migrateExistingProviders(db) {
  ensureSchema(db);
  const current = state(db);
  if (current.migration_done) return;
  const rows = db.prepare("SELECT * FROM ai_provider_settings WHERE provider IN ('9router','orcarouter','agentrouter') AND api_key_encrypted IS NOT NULL AND TRIM(api_key_encrypted)<>''").all();
  const insert = db.prepare(`INSERT OR IGNORE INTO ai_dynamic_provider_profiles(id,name,base_url,api_key_encrypted,selected_model,models_json)
    VALUES(?,?,?,?,?,?)`);
  for (const row of rows) {
    const baseUrl = String(row.base_url || '').replace(/\/+$/, '');
    if (!baseUrl) continue;
    const model = row.text_model || row.default_model || '';
    const modelList = [...new Set([row.text_model, row.default_model].filter(Boolean))];
    insert.run(providerId(baseUrl), DISPLAY_NAMES[row.provider] || inferName(baseUrl), baseUrl, row.api_key_encrypted, model, JSON.stringify(modelList));
  }
  const first = db.prepare('SELECT id FROM ai_dynamic_provider_profiles ORDER BY created_at,id LIMIT 1').get();
  db.prepare('UPDATE ai_dynamic_provider_state SET selected_provider_id=COALESCE(selected_provider_id,?),migration_done=1,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(first?.id || null);
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
  if (Array.isArray(output)) {
    return output.flatMap(item => item?.content || []).map(part => part?.text || part?.value || '').join('').trim();
  }
  return String(payload?.text || payload?.response || '').trim();
}

async function callProvider(row, prompt, transport = fetch) {
  const apiKey = decrypt(row.api_key_encrypted);
  const model = row.selected_model || safeModels(row.models_json)[0];
  if (!model) throw new Error(`${row.name}: belum ada model yang dipilih.`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const chatUrl = join(row.base_url, 'chat/completions');
    let response = await transport(chatUrl, {
      method: 'POST', headers: authHeaders(apiKey), signal: controller.signal,
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false })
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
    const payload = JSON.parse(raw || '{}');
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

function orderedRows(db) {
  migrateExistingProviders(db);
  const all = db.prepare('SELECT * FROM ai_dynamic_provider_profiles ORDER BY created_at,id').all();
  if (!all.length) return [];
  const current = state(db);
  const selected = all.find(row => row.id === current.selected_provider_id) || all[0];
  if (!current.fallback_enabled) return [selected];
  return [selected, ...all.filter(row => row.id !== selected.id)];
}

async function execute(db, prompt, transport = fetch) {
  const value = String(prompt || '').trim();
  if (!value) throw Object.assign(new Error('Prompt wajib diisi.'), { status: 422 });
  const rows = orderedRows(db);
  if (!rows.length) throw Object.assign(new Error('Belum ada provider yang tersimpan.'), { status: 409 });
  let lastError;
  for (const row of rows) {
    try { return await callProvider(row, value, transport); }
    catch (error) {
      lastError = new Error(`${row.name}: ${error.message || 'Provider gagal merespons.'}`);
      if (!state(db).fallback_enabled) break;
    }
  }
  throw Object.assign(lastError || new Error('Semua provider gagal.'), { status: 502 });
}

function publicState(db) {
  migrateExistingProviders(db);
  const current = state(db);
  const all = profiles(db);
  const selected = all.find(item => item.id === current.selected_provider_id) || all[0] || null;
  return { providers: all, selectedProviderId: selected?.id || null, fallbackEnabled: Boolean(current.fallback_enabled) };
}

function install({ app, db, transport = fetch }) {
  ensureSchema(db);
  migrateExistingProviders(db);

  app.get('/api/dynamic-ai/providers', (req, res) => res.json(publicState(db)));

  app.post('/api/dynamic-ai/providers', async (req, res, next) => {
    try {
      const baseUrl = normalizeBaseUrl(req.body?.baseUrl);
      const apiKey = String(req.body?.apiKey || '').trim();
      if (!apiKey) throw Object.assign(new Error('API Key wajib diisi.'), { status: 422 });
      const models = await fetchModels(baseUrl, apiKey, transport);
      const id = providerId(baseUrl);
      const existing = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=? OR base_url=?').get(id, baseUrl);
      const name = existing?.name || inferName(baseUrl);
      const selectedModel = models.includes(existing?.selected_model) ? existing.selected_model : models[0];
      db.prepare(`INSERT INTO ai_dynamic_provider_profiles(id,name,base_url,api_key_encrypted,selected_model,models_json,updated_at)
        VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,api_key_encrypted=excluded.api_key_encrypted,selected_model=excluded.selected_model,models_json=excluded.models_json,updated_at=CURRENT_TIMESTAMP`)
        .run(id, name, baseUrl, encrypt(apiKey), selectedModel, JSON.stringify(models));
      db.prepare('UPDATE ai_dynamic_provider_state SET selected_provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(id);
      res.status(existing ? 200 : 201).json({ ...publicState(db), saved: { id, name, model: selectedModel, models } });
    } catch (error) { next(error); }
  });

  app.post('/api/dynamic-ai/providers/:id/select', (req, res, next) => {
    try {
      const found = db.prepare('SELECT id FROM ai_dynamic_provider_profiles WHERE id=?').get(req.params.id);
      if (!found) throw Object.assign(new Error('Provider tidak ditemukan.'), { status: 404 });
      db.prepare('UPDATE ai_dynamic_provider_state SET selected_provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(req.params.id);
      res.json(publicState(db));
    } catch (error) { next(error); }
  });

  app.post('/api/dynamic-ai/providers/:id/model', (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(req.params.id);
      if (!row) throw Object.assign(new Error('Provider tidak ditemukan.'), { status: 404 });
      const model = String(req.body?.model || '').trim();
      if (!safeModels(row.models_json).includes(model)) throw Object.assign(new Error('Model tidak tersedia pada provider ini.'), { status: 422 });
      db.prepare('UPDATE ai_dynamic_provider_profiles SET selected_model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(model, row.id);
      db.prepare('UPDATE ai_dynamic_provider_state SET selected_provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(row.id);
      res.json(publicState(db));
    } catch (error) { next(error); }
  });

  app.post('/api/dynamic-ai/providers/:id/refresh-models', async (req, res, next) => {
    try {
      const row = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(req.params.id);
      if (!row) throw Object.assign(new Error('Provider tidak ditemukan.'), { status: 404 });
      const models = await fetchModels(row.base_url, decrypt(row.api_key_encrypted), transport);
      const selectedModel = models.includes(row.selected_model) ? row.selected_model : models[0];
      db.prepare('UPDATE ai_dynamic_provider_profiles SET selected_model=?,models_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(selectedModel, JSON.stringify(models), row.id);
      res.json({ ...publicState(db), models });
    } catch (error) { next(error); }
  });

  app.delete('/api/dynamic-ai/providers/:id', (req, res, next) => {
    try {
      const removed = db.prepare('DELETE FROM ai_dynamic_provider_profiles WHERE id=?').run(req.params.id).changes;
      if (!removed) throw Object.assign(new Error('Provider tidak ditemukan.'), { status: 404 });
      const replacement = db.prepare('SELECT id FROM ai_dynamic_provider_profiles ORDER BY created_at,id LIMIT 1').get();
      db.prepare('UPDATE ai_dynamic_provider_state SET selected_provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1').run(replacement?.id || null);
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
}

module.exports = { install, execute, fetchModels, inferName, normalizeBaseUrl };
