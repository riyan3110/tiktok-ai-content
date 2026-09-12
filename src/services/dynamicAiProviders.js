const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const cipherKey = crypto.createHash('sha256').update(config.sessionSecret).digest();
const ROLES = new Set(['text', 'image']);
const initialized = new WeakSet();
const activeRequests = new WeakMap();

function encryptionKey(create = false) {
  const directory = path.dirname(config.databasePath);
  const file = path.join(directory, '.provider-encryption-key');
  if (!fs.existsSync(file) && create) {
    fs.mkdirSync(directory, { recursive: true });
    try { fs.writeFileSync(file, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!fs.existsSync(file)) throw Object.assign(new Error('Kunci enkripsi provider tidak tersedia di backend.'), { status: 503 });
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw Object.assign(new Error('Kunci enkripsi provider tidak valid.'), { status: 503 });
  fs.chmodSync(file, 0o600);
  return key;
}

function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(true), iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return 'v2.' + [iv, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
}

function decrypt(value) {
  if (!value) return '';
  const modern = String(value).startsWith('v2.');
  const [iv, tag, data] = String(value).replace(/^v2\./, '').split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', modern ? encryptionKey() : cipherKey, iv);
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
  if (url.username || url.password || url.search || url.hash) throw Object.assign(new Error('Base URL tidak boleh berisi password, query, atau fragment.'), { status: 422 });
  url.pathname = url.pathname.replace(/\/+(models|chat\/completions|responses|images\/generations)\/?$/, '').replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
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

function providerId(baseUrl, role = 'text') {
  return `custom-${crypto.createHash('sha1').update(`${role}:${baseUrl}`).digest('hex').slice(0, 12)}`;
}

function join(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function ensureColumn(db, table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function ensureSchema(db) {
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_dynamic_provider_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
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
    CREATE TABLE IF NOT EXISTS ai_dynamic_provider_revisions (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0
    );
  `);
  ensureColumn(db, 'ai_dynamic_provider_profiles', 'selected_text_model', 'TEXT');
  ensureColumn(db, 'ai_dynamic_provider_profiles', 'selected_image_model', 'TEXT');
  ensureColumn(db, 'ai_dynamic_provider_state', 'selected_text_provider_id', 'TEXT');
  ensureColumn(db, 'ai_dynamic_provider_state', 'selected_image_provider_id', 'TEXT');
  ensureColumn(db, 'ai_dynamic_provider_profiles', 'roles_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'ai_dynamic_provider_state', 'text_fallback_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'ai_dynamic_provider_state', 'image_fallback_enabled', 'INTEGER NOT NULL DEFAULT 0');
  // Remove the old URL-only uniqueness constraint: Text/Image can use the same
  // endpoint with different credentials and independently discovered catalogs.
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_dynamic_provider_profiles'").get().sql;
  if (/base_url\s+TEXT\s+NOT NULL\s+UNIQUE/i.test(schema)) {
    db.transaction(() => {
      db.exec('ALTER TABLE ai_dynamic_provider_profiles RENAME TO ai_dynamic_provider_profiles_old');
      db.exec(schema.replace(/base_url\s+TEXT\s+NOT NULL\s+UNIQUE/i, 'base_url TEXT NOT NULL'));
      db.exec('INSERT INTO ai_dynamic_provider_profiles SELECT * FROM ai_dynamic_provider_profiles_old');
      db.exec('DROP TABLE ai_dynamic_provider_profiles_old');
    })();
  }
  // Split only profiles already enrolled by this verified-provider service.
  // Never import credentials from ai_provider_settings or environment variables.
  db.transaction(() => {
    for (const row of db.prepare('SELECT * FROM ai_dynamic_provider_profiles').all()) {
      const roles = safeModels(row.roles_json).filter(role => ROLES.has(role));
      if (!roles.length || (roles.length === 1 && row.id === providerId(row.base_url, roles[0]))) continue;
      for (const role of roles) {
        const id = providerId(row.base_url, role);
        db.prepare(`INSERT OR IGNORE INTO ai_dynamic_provider_profiles(id,name,base_url,api_key_encrypted,selected_model,selected_text_model,selected_image_model,models_json,roles_json,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, row.name, row.base_url, row.api_key_encrypted,
          role === 'text' ? row.selected_text_model : null, role === 'text' ? row.selected_text_model : null,
          role === 'image' ? row.selected_image_model : null, row.models_json, JSON.stringify([role]), row.created_at, row.updated_at);
        db.prepare(`UPDATE ai_dynamic_provider_state SET selected_${role}_provider_id=? WHERE selected_${role}_provider_id=?`).run(id, row.id);
      }
      db.prepare('DELETE FROM ai_dynamic_provider_profiles WHERE id=?').run(row.id);
    }
  })();
  // Existing profiles are preserved, but are not silently enrolled in either role.
  // Explicitly saving with a verified key enrolls a profile and refreshes its catalog.
  db.prepare('UPDATE ai_dynamic_provider_state SET migration_done=1, selected_provider_id=NULL, fallback_enabled=0 WHERE id=1').run();
  initialized.add(db);
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
  return String((role === 'image' ? row?.selected_image_model : row?.selected_text_model) || '').trim();
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
    roles: safeModels(row.roles_json),
    hasApiKey: Boolean(row.api_key_encrypted),
    updatedAt: row.updated_at
  }));
}

function migrateExistingProviders(db) { ensureSchema(db); }

function selectedProfile(db, role = 'text') {
  role = normalizeRole(role);
  const current = state(db);
  const id = current[`selected_${role}_provider_id`];
  const row = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(id);
  return row && safeModels(row.roles_json).includes(role) ? row : null;
}

function fallbackEnabled(db, role) { return Boolean(state(db)[`${role}_fallback_enabled`]); }

function providerError(status) {
  const detail = status === 401 ? 'API Key ditolak' : status === 403 ? 'akses API ditolak' : status === 429 ? 'kuota/rate limit tercapai' : 'request provider gagal';
  return Object.assign(new Error(`${detail} (HTTP ${status}).`), { status: status >= 400 && status <= 599 ? status : 502 });
}

function revision(db, id) { return db.prepare('SELECT revision FROM ai_dynamic_provider_revisions WHERE id=?').get(id)?.revision || 0; }
function invalidate(db, id) {
  db.prepare('INSERT INTO ai_dynamic_provider_revisions(id,revision) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET revision=revision+1').run(id);
  for (const controller of activeRequests.get(db)?.get(id) || []) controller.abort();
}

async function withRequest(db, row, operation) {
  if (!db.prepare('SELECT id FROM ai_dynamic_provider_profiles WHERE id=?').get(row.id)) throw new Error('Provider sudah dihapus.');
  if (!activeRequests.has(db)) activeRequests.set(db, new Map());
  const requests = activeRequests.get(db);
  if (!requests.has(row.id)) requests.set(row.id, new Set());
  const controller = new AbortController();
  const version = revision(db, row.id);
  requests.get(row.id).add(controller);
  try {
    const result = await operation(controller.signal);
    if (version !== revision(db, row.id)) throw new Error('Konfigurasi provider berubah. Kirim ulang request.');
    return result;
  } finally { requests.get(row.id)?.delete(controller); }
}

function removeProvider(db, id) {
  ensureSchema(db);
  db.transaction(() => {
    const row = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(id);
    if (!row) throw Object.assign(new Error('Provider tidak ditemukan.'), { status: 404 });
    // Delete matching legacy credentials and references, never restore from legacy.
    const legacy = db.prepare('SELECT provider,base_url FROM ai_provider_settings').all().filter(item => {
      try { return normalizeBaseUrl(item.base_url) === row.base_url; } catch { return false; }
    });
    for (const item of legacy) {
      db.prepare('DELETE FROM ai_provider_defaults WHERE provider=?').run(item.provider);
      db.prepare('DELETE FROM ai_provider_health WHERE provider=?').run(item.provider);
      db.prepare('DELETE FROM ai_provider_model_capabilities WHERE provider=?').run(item.provider);
      db.prepare('DELETE FROM ai_provider_settings WHERE provider=?').run(item.provider);
    }
    db.prepare('DELETE FROM ai_dynamic_provider_profiles WHERE id=?').run(id);
    for (const role of ROLES) {
      const replacement = db.prepare('SELECT * FROM ai_dynamic_provider_profiles ORDER BY created_at,id').all()
        .find(item => safeModels(item.roles_json).includes(role));
      db.prepare(`UPDATE ai_dynamic_provider_state SET selected_${role}_provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE selected_${role}_provider_id=?`)
        .run(replacement?.id || null, id);
    }
    db.prepare('UPDATE ai_dynamic_provider_state SET selected_provider_id=NULL,migration_done=1 WHERE id=1').run();
    invalidate(db, id);
  })();
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
    const response = await transport(join(baseUrl, 'models'), { headers: authHeaders(apiKey), signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    if (!response.ok) throw providerError(response.status);
    let payload;
    try { payload = JSON.parse(text); } catch { throw Object.assign(new Error('Daftar model dari provider bukan JSON yang valid.'), { status: 502 }); }
    const models = modelIds(payload);
    if (!models.length) throw Object.assign(new Error('Provider terhubung, tetapi daftar model kosong/tidak dikenali.'), { status: 422 });
    let authenticated = false;
    for (const path of ['models', 'key', 'auth/key']) {
      if (path !== 'models') {
        const check = await transport(join(baseUrl, path), { headers: authHeaders(apiKey), signal: controller.signal, redirect: 'error' });
        await check.body?.cancel();
        if (!check.ok) continue;
      }
      const invalid = await transport(join(baseUrl, path), {
        headers: authHeaders(`invalid-${crypto.randomUUID()}`), signal: controller.signal, redirect: 'error'
      });
      await invalid.body?.cancel();
      if ([401, 403].includes(invalid.status)) { authenticated = true; break; }
    }
    if (!authenticated) throw Object.assign(new Error('Endpoint provider tidak dapat membuktikan validitas API Key. Provider belum disimpan.'), { status: 422 });
    return models;
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error(error.name === 'AbortError' ? 'Koneksi provider melewati batas waktu.' : 'Tidak dapat menghubungi endpoint models provider.'), { status: 502 });
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
  const model = roleModel(row, 'text');
  if (!model || !safeModels(row.models_json).includes(model)) throw Object.assign(new Error('Model Text AI belum dipilih atau tidak tersedia pada katalog terbaru.'), { status: 409 });
  const messages = Array.isArray(request?.messages) && request.messages.length
    ? request.messages
    : [{ role: 'user', content: String(request?.prompt || '') }];
  const prompt = String(request?.prompt || messagesToPrompt(messages)).trim();
  const started = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  request?.signal?.addEventListener('abort', abort, { once: true });
  if (request?.signal?.aborted) abort();
  const timer = setTimeout(abort, 60000);
  try {
    let response = await transport(join(row.base_url, 'chat/completions'), {
      method: 'POST', headers: authHeaders(apiKey), signal: controller.signal, redirect: 'error',
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...Object.fromEntries(['max_tokens', 'max_completion_tokens', 'top_p', 'seed', 'stop', 'presence_penalty', 'frequency_penalty'].filter(key => request?.parameters?.[key] !== undefined).map(key => [key, request.parameters[key]])),
        ...(request?.responseFormat ? { response_format: request.responseFormat } : {}),
        ...(Number.isFinite(request?.temperature) ? { temperature: request.temperature } : {})
      })
    });
    let raw = await response.text();
    if (!response.ok && [404, 405].includes(response.status)) {
      response = await transport(join(row.base_url, 'responses'), {
        method: 'POST', headers: authHeaders(apiKey), signal: controller.signal, redirect: 'error',
        body: JSON.stringify({ model, input: messages.map(message => ({ ...message, content: Array.isArray(message.content) ? message.content.map(part => part.type === 'image_url' ? { type: 'input_image', image_url: part.image_url.url } : { type: 'input_text', text: part.text || '' }) : message.content })), ...(request?.responseFormat ? { text: { format: request.responseFormat } } : {}) })
      });
      raw = await response.text();
    }
    if (!response.ok) throw providerError(response.status);
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { throw new Error('Provider mengembalikan response non-JSON.'); }
    const text = textFromChat(payload);
    if (!text) throw new Error('Provider merespons tetapi tidak mengembalikan teks.');
    const usage = payload.usage || {};
    return {
      text, provider: row.name, providerId: row.id, model: payload.model || model, requestedModel: model, responseTime: Date.now() - started,
      usage: {
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0
      }
    };
  } finally { clearTimeout(timer); request?.signal?.removeEventListener('abort', abort); }
}

async function callImageProvider(row, prompt, options = {}, transport = fetch) {
  const apiKey = decrypt(row.api_key_encrypted);
  const model = roleModel(row, 'image');
  if (!model || !safeModels(row.models_json).includes(model)) throw Object.assign(new Error('Model Image AI belum dipilih atau tidak tersedia pada katalog terbaru.'), { status: 409 });
  const controller = new AbortController();
  const started = Date.now();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, 120000);
  try {
    const body = {
      model,
      prompt,
      n: 1,
      ...(options.size ? { size: options.size } : {}),
      ...(options.responseFormat ? { response_format: options.responseFormat } : {})
    };
    let path = 'images/generations';
    let requestBody = JSON.stringify(body);
    let headers = authHeaders(apiKey);
    if (options.assets?.length) {
      const { StorageService } = require('../storage/service');
      const storage = new StorageService({ db: options.db });
      const form = new FormData();
      for (const [key, value] of Object.entries(body)) form.append(key, String(value));
      for (const reference of options.assets) {
        const asset = storage.repository.get(reference.id);
        if (!asset) throw Object.assign(new Error('Asset referensi gambar tidak ditemukan.'), { status: 422 });
        const preview = await storage.preview(asset);
        if (!preview.mimeType.startsWith('image/')) throw Object.assign(new Error('Referensi Image AI harus berupa gambar.'), { status: 422 });
        form.append(options.assets.length > 1 ? 'image[]' : 'image', new Blob([preview.data], { type: preview.mimeType }), asset.name || 'reference.png');
      }
      path = 'images/edits';
      requestBody = form;
      headers = { Authorization: `Bearer ${apiKey}` };
    }
    const response = await transport(join(row.base_url, path), {
      method: 'POST', headers, signal: controller.signal, redirect: 'error', body: requestBody
    });
    const raw = await response.text();
    if (!response.ok) throw providerError(response.status);
    let payload;
    try { payload = JSON.parse(raw || '{}'); } catch { throw new Error('Provider image mengembalikan response non-JSON.'); }
    const item = payload?.data?.[0] || payload?.result?.data?.[0] || payload?.result || payload;
    const url = item?.url || item?.image_url || item?.output_url || null;
    const b64Json = item?.b64_json || item?.base64 || null;
    if (!url && !b64Json) throw new Error('Provider image merespons tetapi tidak mengembalikan URL/base64 gambar.');
    return { provider: row.name, providerId: row.id, model: payload.model || model, requestedModel: model, responseTime: Date.now() - started, url, b64Json, revisedPrompt: item?.revised_prompt || null };
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}

function orderedRows(db, role = 'text') {
  role = normalizeRole(role);
  const selected = selectedProfile(db, role);
  if (!selected) return [];
  if (!fallbackEnabled(db, role)) return [selected];
  const all = db.prepare('SELECT * FROM ai_dynamic_provider_profiles ORDER BY created_at,id').all();
  return [selected, ...all.filter(row => row.id !== selected.id && safeModels(row.roles_json).includes(role) && roleModel(row, role))];
}

async function executeMessages(db, messages, transport = fetch, options = {}) {
  const rows = orderedRows(db, 'text');
  if (!rows.length) throw Object.assign(new Error('Belum ada provider Text AI yang tersimpan.'), { status: 409 });
  let lastError;
  for (const candidate of rows) {
    const row = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(candidate.id);
    if (!row || !safeModels(row.roles_json).includes('text')) continue;
    try { return await withRequest(db, row, signal => callTextProvider(row, { ...options, messages, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal }, transport)); }
    catch (error) {
      lastError = new Error(`${row.name}: ${error.status ? error.message : 'Provider gagal merespons atau konfigurasi berubah.'}`);
      if (!fallbackEnabled(db, 'text')) break;
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
  for (const candidate of rows) {
    const row = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(candidate.id);
    if (!row || !safeModels(row.roles_json).includes('image')) continue;
    try { return await withRequest(db, row, signal => callImageProvider(row, value, { ...options, db, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal }, transport)); }
    catch (error) {
      lastError = new Error(`${row.name}: ${error.status ? error.message : 'Provider image gagal merespons atau konfigurasi berubah.'}`);
      if (!fallbackEnabled(db, 'image')) break;
    }
  }
  throw Object.assign(lastError || new Error('Semua provider Image AI gagal.'), { status: 502 });
}

function publicState(db) {
  migrateExistingProviders(db);
  const current = state(db);
  const all = profiles(db);
  const text = all.find(item => item.id === current.selected_text_provider_id && item.roles.includes('text')) || null;
  const image = all.find(item => item.id === current.selected_image_provider_id && item.roles.includes('image')) || null;
  return {
    providers: all,
    selectedProviderId: text?.id || null,
    defaults: {
      text: { providerId: text?.id || null, model: text?.textModel || null, fallbackEnabled: Boolean(current.text_fallback_enabled) },
      image: { providerId: image?.id || null, model: image?.imageModel || null, fallbackEnabled: Boolean(current.image_fallback_enabled) }
    },
    fallbackEnabled: Boolean(current.text_fallback_enabled)
  };
}

function setDefault(db, role, providerIdValue, modelValue) {
  role = normalizeRole(role);
  ensureSchema(db);
  const row = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(providerIdValue);
  if (!row) throw Object.assign(new Error('Provider tidak ditemukan.'), { status: 404 });
  if (!safeModels(row.roles_json).includes(role)) throw Object.assign(new Error('Simpan dan validasi provider untuk kategori ini terlebih dahulu.'), { status: 422 });
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
            parameters: payload,
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
            providerId: result.providerId,
            responseTime: result.responseTime,
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
      const id = providerId(baseUrl, role);
      const version = revision(db, id);
      const models = await fetchModels(baseUrl, apiKey, transport);
      if (version !== revision(db, id)) throw Object.assign(new Error('Provider berubah selama validasi. Silakan simpan ulang.'), { status: 409 });
      const existing = db.prepare('SELECT * FROM ai_dynamic_provider_profiles WHERE id=?').get(id);
      const name = existing?.name || inferName(baseUrl);
      const textModel = role === 'text' ? (models.includes(existing?.selected_text_model) ? existing.selected_text_model : models[0]) : existing?.selected_text_model || null;
      const imageModel = role === 'image' ? (models.includes(existing?.selected_image_model) ? existing.selected_image_model : models[0]) : existing?.selected_image_model || null;
      db.transaction(() => {
      if (version !== revision(db, id)) throw Object.assign(new Error('Provider berubah selama validasi. Silakan simpan ulang.'), { status: 409 });
      db.prepare(`INSERT INTO ai_dynamic_provider_profiles(id,name,base_url,api_key_encrypted,selected_model,selected_text_model,selected_image_model,models_json,updated_at)
        VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,api_key_encrypted=excluded.api_key_encrypted,selected_model=excluded.selected_model,selected_text_model=excluded.selected_text_model,selected_image_model=excluded.selected_image_model,models_json=excluded.models_json,updated_at=CURRENT_TIMESTAMP`)
        .run(id, name, baseUrl, encrypt(apiKey), textModel, textModel, imageModel, JSON.stringify(models));
      db.prepare('UPDATE ai_dynamic_provider_profiles SET roles_json=? WHERE id=?').run(JSON.stringify([role]), id);
      setDefault(db, role, id, role === 'image' ? imageModel : textModel);
      invalidate(db, id);
      })();
      res.status(existing ? 200 : 201).json({ ...publicState(db), saved: { id, name, role, model: role === 'image' ? imageModel : textModel, textModel, imageModel, models } });
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
      const version = revision(db, row.id);
      const models = await fetchModels(row.base_url, decrypt(row.api_key_encrypted), transport);
      if (version !== revision(db, row.id) || !db.prepare('SELECT id FROM ai_dynamic_provider_profiles WHERE id=?').get(row.id)) throw Object.assign(new Error('Provider berubah selama refresh.'), { status: 409 });
      const textModel = models.includes(row.selected_text_model) ? row.selected_text_model : null;
      const imageModel = models.includes(row.selected_image_model) ? row.selected_image_model : null;
      db.prepare('UPDATE ai_dynamic_provider_profiles SET selected_model=?,selected_text_model=?,selected_image_model=?,models_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(textModel, textModel, imageModel, JSON.stringify(models), row.id);
      res.json({ ...publicState(db), models });
    } catch (error) { next(error); }
  });

  app.delete('/api/dynamic-ai/providers/:id', (req, res, next) => {
    try {
      removeProvider(db, req.params.id);
      res.json(publicState(db));
    } catch (error) { next(error); }
  });

  app.put('/api/dynamic-ai/fallback', (req, res, next) => {
    try {
      const role = normalizeRole(req.body?.role);
      if (typeof req.body?.enabled !== 'boolean') throw Object.assign(new Error('Fallback harus boolean.'), { status: 422 });
      db.prepare(`UPDATE ai_dynamic_provider_state SET ${role}_fallback_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`).run(Number(req.body.enabled));
      res.json(publicState(db));
    } catch (error) { next(error); }
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
  ensureSchema,
  removeProvider,
  orderedRows,
  setDefault,
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
