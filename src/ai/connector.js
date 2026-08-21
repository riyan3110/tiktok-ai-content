const crypto = require('node:crypto');
const config = require('../config');
const { ProviderFactory } = require('../providers');
const { normalizeError } = require('./errors');
const { buildGenerationRequest } = require('./requestBuilder');

const active = new Map();
const key = crypto.createHash('sha256').update(config.sessionSecret).digest();
function encrypt(value) { if (!value) return null; const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return [iv, cipher.getAuthTag(), data].map(x => x.toString('base64url')).join('.'); }
function decrypt(value) { if (!value) return ''; const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64url')); const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'); }
const DISPLAY_NAMES = Object.freeze({ '9router': '9Router', orcarouter: 'OrcaRouter', agentrouter: 'AgentRouter', 'google-flow': 'Google Flow', 'google-veo': 'Google Veo', 'google-imagen': 'Google Imagen', 'google-gemini': 'Google Gemini', 'openai-images': 'OpenAI Images', vidu: 'Vidu', zark: 'Zark', omni: 'Omni' });
const publicSetting = (row, defaults = []) => ({ provider: row.provider, name: DISPLAY_NAMES[row.provider], capabilities: CAPABILITIES[row.provider] || [], baseUrl: row.base_url, organizationId: row.organization_id, region: row.region, defaultModel: row.default_model, textModel: row.text_model, imageModel: row.image_model, videoModel: row.video_model, timeout: row.timeout_ms, retry: row.retry_count, enabled: Boolean(row.enabled), hasApiKey: Boolean(row.api_key_encrypted), ...(row.provider === '9router' ? {} : { apiKey: row.api_key_encrypted ? '••••••••' : '' }), defaultCapabilities: defaults, isDefault: defaults.length > 0, updatedAt: row.updated_at });
const CAPABILITIES = Object.freeze({ '9router': ['text', 'image', 'video'], orcarouter: ['text', 'image', 'video'], agentrouter: ['text'], 'google-flow': ['image', 'video'], 'google-veo': ['video'], 'google-imagen': ['image'], 'google-gemini': ['image'], 'openai-images': ['image'], vidu: ['image', 'video'], zark: ['image', 'video'], omni: ['image', 'video'] });
const PLACEHOLDER_HOSTS = /(^|\.)(example\.(com|org|net)|localhost|invalid)$/i;

function seed(db) { db.transaction(() => { for (const provider of ProviderFactory.names()) { const defaults = ProviderFactory.defaults(provider); db.prepare('INSERT OR IGNORE INTO ai_provider_settings(provider,base_url,default_model) VALUES(?,?,?)').run(provider, defaults.baseUrl, defaults.model); }
  db.prepare("UPDATE ai_provider_settings SET text_model=COALESCE(text_model,'orcarouter/auto'),image_model=COALESCE(image_model,'openai/gpt-image-1'),video_model=COALESCE(video_model,'kling/kling-v2-6') WHERE provider='orcarouter'").run();
  db.prepare("UPDATE ai_provider_settings SET base_url='https://agentrouter.org',text_model=COALESCE(text_model,default_model,'gpt-5.5') WHERE provider='agentrouter' AND base_url IN ('https://co.agentrouter.org','https://co.agentrouter.org/v1','https://agentrouter.org/v1','https://agentrouter.org/v1/responses')").run();
  const target = db.prepare("SELECT * FROM ai_provider_settings WHERE provider='orcarouter'").get(); const legacy = db.prepare("SELECT * FROM ai_provider_settings WHERE provider='openai'").get();
  if (!target.api_key_encrypted && legacy?.api_key_encrypted) db.prepare("UPDATE ai_provider_settings SET api_key_encrypted=?,base_url='https://api.orcarouter.ai',default_model='orcarouter/auto',timeout_ms=?,retry_count=?,enabled=? WHERE provider='orcarouter' AND (api_key_encrypted IS NULL OR api_key_encrypted='')").run(legacy.api_key_encrypted, legacy.timeout_ms, legacy.retry_count, legacy.enabled);
})(); }
function setting(db, provider) { seed(db); const row = db.prepare('SELECT * FROM ai_provider_settings WHERE provider=?').get(provider); if (!row) throw Object.assign(new Error('Provider not found'), { status: 404 }); return row; }
function configured(row) { return { ...row, api_key: decrypt(row.api_key_encrypted) }; }
function validBaseUrl(value) { try { const url = new URL(String(value || '')); return /^https?:$/.test(url.protocol) && !PLACEHOLDER_HOSTS.test(url.hostname) && !/(placeholder|your[-_.]?api|change[-_.]?me)/i.test(url.href); } catch { return false; } }
function configuredProviders(db) {
  seed(db);
  const registered = new Set(ProviderFactory.names());
  const valid = db.prepare('SELECT * FROM ai_provider_settings WHERE enabled=1 AND default_model IS NOT NULL AND TRIM(default_model)<>\'\'').all().filter(row => registered.has(row.provider) && Boolean(row.api_key_encrypted) && validBaseUrl(row.base_url) && !(row.provider === 'google-flow' && row.base_url === ProviderFactory.defaults('google-flow').baseUrl));
  return valid;
}
function validationError(message, status = 422, extra = {}) { return Object.assign(new Error(message), { status, ...extra }); }
function validateGeneration(db, body = {}) {
  seed(db); const textDefaultProvider = body.provider === 'orcarouter' || body.provider === 'agentrouter'; const mediaType = ['text', 'image', 'video'].includes(body.mediaType) ? body.mediaType : (textDefaultProvider ? 'text' : 'image');
  const valid = configuredProviders(db); const defaultId = db.prepare('SELECT provider FROM ai_provider_defaults WHERE capability=?').get(mediaType)?.provider; const defaultRow = valid.find(row => row.provider === defaultId) || (valid.length === 1 ? valid[0] : null);
  const provider = body.provider || defaultRow?.provider;
  if (!provider) throw validationError('Provider belum diaktifkan', 409);
  if (!ProviderFactory.names().includes(provider)) throw validationError(`Provider ID tidak valid: ${provider}`);
  const row = db.prepare('SELECT * FROM ai_provider_settings WHERE provider=?').get(provider);
  if (!row?.enabled) throw validationError('Provider belum diaktifkan', 409);
  if (!(CAPABILITIES[provider] || []).includes(mediaType)) throw validationError(`Provider aktif tidak mendukung generate ${mediaType}`, 409);
  if (!row.api_key_encrypted) throw validationError('API key provider belum tersedia');
  if (!row.default_model?.trim()) throw validationError('Model provider belum tersedia');
  if (provider === 'google-flow' && row.base_url === ProviderFactory.defaults('google-flow').baseUrl) throw validationError('Google Flow generation API belum dikonfigurasi', 409);
  if (!validBaseUrl(row.base_url)) throw validationError(provider === 'omni' ? 'Omni masih menggunakan endpoint placeholder' : 'Base URL provider belum valid', 409);
  const prompt = String(body.prompt || '').trim(); if (!prompt) throw validationError('Prompt wajib diisi');
  const unresolvedVariables = [...new Set([...prompt.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map(match => match[1]))];
  if (unresolvedVariables.length) throw validationError('Prompt template belum lengkap', 422, { unresolvedVariables });
  const count = body.count === undefined ? 1 : Number(body.count); if (!Number.isInteger(count) || count < 1 || count > 10) throw validationError('Jumlah batch harus antara 1 dan 10');
  buildGenerationRequest({ ...body, mediaType }, row);
  return { provider, row, mediaType, count };
}
function save(db, provider, body) { const old = setting(db, provider); const encrypted = body.apiKey === undefined ? old.api_key_encrypted : encrypt(String(body.apiKey || '')); if (body.isDefault) { const capability = body.defaultCapability || CAPABILITIES[provider]?.[0]; if (!CAPABILITIES[provider]?.includes(capability)) throw validationError('Provider tidak mendukung capability default tersebut'); db.prepare('INSERT INTO ai_provider_defaults(capability,provider) VALUES(?,?) ON CONFLICT(capability) DO UPDATE SET provider=excluded.provider').run(capability, provider); }
  db.prepare(`UPDATE ai_provider_settings SET api_key_encrypted=?,base_url=?,organization_id=?,region=?,default_model=?,text_model=?,image_model=?,video_model=?,timeout_ms=?,retry_count=?,enabled=?,updated_at=CURRENT_TIMESTAMP WHERE provider=?`).run(encrypted, String(body.baseUrl ?? old.base_url), body.organizationId ?? old.organization_id, body.region ?? old.region, body.defaultModel ?? old.default_model, body.textModel ?? old.text_model, body.imageModel ?? old.image_model, body.videoModel ?? old.video_model, clamp(body.timeout ?? old.timeout_ms, 1000, 300000), clamp(body.retry ?? old.retry_count, 0, 10), body.enabled === undefined ? old.enabled : Number(Boolean(body.enabled)), provider); return publicSetting(setting(db, provider), defaultCapabilities(db, provider)); }
function defaultCapabilities(db, provider) { return db.prepare('SELECT capability FROM ai_provider_defaults WHERE provider=? ORDER BY capability').all(provider).map(row => row.capability); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || min)); }
function updateHealth(db, provider, success, data = {}) { db.prepare(`INSERT INTO ai_provider_health(provider,status,latency_ms,last_success,last_failure,quota_status,provider_version) VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET status=excluded.status,latency_ms=excluded.latency_ms,last_success=COALESCE(excluded.last_success,ai_provider_health.last_success),last_failure=COALESCE(excluded.last_failure,ai_provider_health.last_failure),quota_status=excluded.quota_status,provider_version=excluded.provider_version,updated_at=CURRENT_TIMESTAMP`).run(provider, success ? 'Online' : 'Offline', data.responseTime ?? null, success ? new Date().toISOString() : null, success ? null : new Date().toISOString(), data.quotaStatus || (success ? 'Available' : 'Unknown'), data.providerVersion || null); }
async function retry(task, count, progress) { let last; for (let attempt = 0; attempt <= count; attempt += 1) { try { return await task(); } catch (error) { last = error; if (attempt === count || error.nonRetryable || error.name === 'AbortError' || error.cause?.name === 'AbortError' || ['Authentication Error', 'Model Not Found', 'Quota Exceeded'].includes(error.type)) throw error; progress('Retrying'); } } throw last; }
async function execute(db, body, transport, progress = () => {}, suppliedId) { const validated = validateGeneration(db, body); const requestedProvider = validated.provider; const row = validated.row;
  const id = suppliedId || body.id || crypto.randomUUID(); const started = new Date(); const request = buildGenerationRequest(body, row); const prompt = request.prompt;
  db.prepare('INSERT OR IGNORE INTO ai_generations(id,provider,model,prompt,status,prompt_size,request_time,media_type,assets,metadata) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, requestedProvider, request.model, prompt, 'Preparing', Buffer.byteLength(prompt), started.toISOString(), request.mediaType, JSON.stringify(request.assets), JSON.stringify(request.metadata));
  const controller = new AbortController(); active.set(id, controller); const timeout = setTimeout(() => controller.abort(), row.timeout_ms); const adapter = ProviderFactory.create(configured(row), transport);
  try { progress('Preparing', id); if (request.assets.length) { updateStatus(db, id, 'Uploading'); progress('Uploading', id); } const result = await retry(() => adapter.execute({ ...request, stream: Boolean(body.stream) }, { signal: controller.signal, onProgress: status => { const mapped = status === 'Sending' ? 'Generating' : status === 'Receiving' ? 'Downloading' : status; updateStatus(db, id, mapped); progress(mapped, id); } }), row.retry_count, status => { updateStatus(db, id, status); progress(status, id); });
    const usage = result.usage; usage.totalTokens ||= usage.promptTokens + usage.completionTokens; const completed = new Date(); const cost = estimate(body.provider, usage);
    db.prepare(`UPDATE ai_generations SET status='Completed',output=?,media=?,provider_job_id=?,provider_request_id=?,prompt_tokens=?,completion_tokens=?,total_tokens=?,estimated_cost=?,response_time=?,duration_ms=?,endpoint=?,output_size=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(result.content, JSON.stringify(result.media || []), result.providerJobId, result.providerRequestId || null, usage.promptTokens, usage.completionTokens, usage.totalTokens, cost, completed.toISOString(), completed - started, result.endpoint || adapter.endpoint(adapter.requestPath(request)), Buffer.byteLength(result.content), id); progress('Completed', id); updateHealth(db, requestedProvider, true, { responseTime: completed - started }); return generation(db, id);
  } catch (caught) { const error = normalizeError(caught); const cancelled = controller.signal.aborted && active.get(id)?.cancelled; const status = cancelled ? 'Cancelled' : 'Failed'; const endpoint = caught.endpoint || adapter.endpoint(adapter.requestPath(request)); db.prepare('UPDATE ai_generations SET status=?,error_type=?,error_code=?,error_message=?,provider_status=?,provider_request_id=?,endpoint=?,response_time=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, cancelled ? null : error.type, cancelled ? null : (caught.code || error.code || null), error.message, caught.status || error.status || null, caught.providerRequestId || null, endpoint, new Date().toISOString(), id); progress(status, id); updateHealth(db, requestedProvider, false); if (cancelled) return generation(db, id); throw Object.assign(error, { generationId: id });
  } finally { clearTimeout(timeout); active.delete(id); }
}
function updateStatus(db, id, status) { db.prepare('UPDATE ai_generations SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id); }
function generation(db, id) { return db.prepare('SELECT * FROM ai_generations WHERE id=?').get(id); }
function estimate(provider, usage) { const perMillion = { openai: 0.6, claude: 3, gemini: 0.35 }[provider] || 0; return Number(((usage.totalTokens / 1e6) * perMillion).toFixed(8)); }
function cancel(id) { const controller = active.get(id); if (!controller) return false; controller.cancelled = true; controller.abort(); return true; }
function markCancelled(db, id) { return db.prepare("UPDATE ai_generations SET status='Cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('Completed','Failed','Cancelled')").run(id).changes > 0; }

module.exports = { seed, setting, save, publicSetting, configured, configuredProviders, validateGeneration, validBaseUrl, CAPABILITIES, defaultCapabilities, updateHealth, execute, generation, cancel, markCancelled };
