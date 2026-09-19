const dynamicAi = require('../services/dynamicAiProviders');
const crypto = require('node:crypto');
const active = new Map();
const CAPABILITIES = Object.freeze({});
const PLACEHOLDER_HOSTS = /(^|\.)(example\.(com|org|net)|localhost|invalid)$/i;
function seed(db) { dynamicAi.ensureSchema(db); }
function setting() { throw validationError('Provider lama sudah dihapus. Gunakan Provider AI manual.', 410); }
function validBaseUrl(value) { try { const url = new URL(String(value || '')); return /^https?:$/.test(url.protocol) && !PLACEHOLDER_HOSTS.test(url.hostname) && !/(placeholder|your[-_.]?api|change[-_.]?me)/i.test(url.href); } catch { return false; } }
function configuredProviders(db) {
  seed(db);
  const current = dynamicAi.publicState(db);
  const dynamic = current.providers.filter(row => row.roles.length).map(row => ({
    provider: row.id, name: row.name, roles: row.roles, base_url: row.baseUrl,
    default_model: row.textModel || row.imageModel, text_model: row.textModel, image_model: row.imageModel,
    defaults: ['text', 'image'].filter(role => current.defaults[role].providerId === row.id)
  }));
  return dynamic;
}
function validationError(message, status = 422, extra = {}) { return Object.assign(new Error(message), { status, ...extra }); }
function validateGeneration(db, body = {}) {
  if (body.mediaType !== 'video') {
    const mediaType = body.mediaType === 'image' ? 'image' : 'text';
    const row = dynamicAi.selectedProfile(db, mediaType);
    if (!row) throw validationError(`Default ${mediaType === 'text' ? 'Text' : 'Image'} AI belum dipilih`, 409);
    const model = row[`selected_${mediaType}_model`];
    if (!model || !JSON.parse(row.models_json || '[]').includes(model)) throw validationError('Model aktif belum dipilih atau tidak tersedia', 409);
    if ((body.provider && body.provider !== row.id) || (body.model && body.model !== model)) throw validationError('Pilihan provider/model berubah. Muat ulang dan pilih konfigurasi aktif.', 409);
    if (!String(body.prompt || '').trim()) throw validationError('Prompt wajib diisi');
    const count = body.count === undefined ? 1 : Number(body.count);
    if (!Number.isInteger(count) || count < 1 || count > 10) throw validationError('Jumlah batch harus antara 1 dan 10');
    return { provider: row.id, row: { ...row, provider: row.id, default_model: model }, mediaType, count, dynamic: true };
  }
  throw validationError('Belum ada provider video manual yang dikonfigurasi.', 409);
}
function save() { throw validationError('Gunakan halaman Provider AI untuk menyimpan dan memvalidasi provider.', 410); }

function isVagueFloatingMediaPrompt(body = {}) {
  if (!['image', 'video'].includes(body.mediaType)) return false;
  const value = String(body.prompt || '').trim().toLowerCase();
  if (!value || value.length > 120) return false;
  return /^(?:tolong\s+)?(?:buat|buatkan|bikin|bikinin|generate|hasilkan|jadikan|lanjutkan)?\s*(?:gambar|gambarnya|foto|fotonya|image|video|videonya|itu|yang itu|yang tadi|tersebut)?[.!?\s]*$/i.test(value)
    || /^(?:buatkan|bikin|generate|hasilkan|jadikan)\s+(?:gambar|gambarnya|foto|fotonya|video|videonya|itu|yang tadi|tersebut)(?:\s+(?:sekarang|aja|saja))?[.!?\s]*$/i.test(value);
}
function stripMarkdown(value = '') {
  return String(value).replace(/```[\s\S]*?```/g, ' ').replace(/[*_`>#]/g, ' ').replace(/\s+/g, ' ').trim();
}
function extractFocusedMediaPrompt(rows, mediaType) {
  const assistants = rows.filter(row => row.role === 'assistant').map(row => String(row.content || '').trim()).filter(Boolean).reverse();
  const labels = mediaType === 'video'
    ? ['prompt video', 'video prompt', 'prompt']
    : ['prompt iklan', 'prompt gambar', 'image prompt', 'prompt'];
  for (const content of assistants) {
    for (const label of labels) {
      const pattern = new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:?\\s*(?:\\n|$)([\\s\\S]*?)(?=\\n\\s*(?:\\*\\*)?[A-Za-z][^\\n]{0,40}(?:\\*\\*)?\\s*:|$)`, 'i');
      const match = content.match(pattern);
      if (match?.[1]) {
        const focused = stripMarkdown(match[1]).replace(/^['“"]|['”"]$/g, '').trim();
        if (focused.length >= 20) return focused.slice(0, 1850);
      }
    }
  }
  const latestAssistant = assistants[0] ? stripMarkdown(assistants[0]) : '';
  const latestUser = rows.filter(row => row.role === 'user').map(row => stripMarkdown(row.content)).filter(Boolean).reverse().find(value => !/^(?:buat|buatkan|bikin|generate|hasilkan|jadikan).*(?:gambar|foto|video|itu|yang tadi)/i.test(value)) || '';
  const fallback = [latestUser, latestAssistant].filter(Boolean).join('. ');
  return fallback.slice(0, 1850);
}
function enrichFloatingMediaBody(db, body = {}) {
  if (!isVagueFloatingMediaPrompt(body)) return body;
  try {
    const latest = String(body.prompt || '').trim();
    const session = db.prepare('SELECT id,updated_at FROM floating_chat_sessions ORDER BY updated_at DESC LIMIT 1').get();
    if (!session?.id) return body;
    const rows = db.prepare('SELECT role,content FROM floating_chat_messages WHERE session_id=? ORDER BY id DESC LIMIT 10').all(session.id).reverse();
    const latestUser = [...rows].reverse().find(row => row.role === 'user');
    if (!latestUser || String(latestUser.content || '').trim().toLowerCase() !== latest.toLowerCase()) return body;
    const focused = extractFocusedMediaPrompt(rows, body.mediaType);
    if (!focused) return body;
    return { ...body, prompt: focused };
  } catch (_) { return body; }
}

async function execute(db, body, transport, progress = () => {}, suppliedId) {
  body = enrichFloatingMediaBody(db, body);
  const validated = validateGeneration(db, body);
  return executeDynamic(db, body, validated, transport, progress, suppliedId);
}
async function executeDynamic(db, body, validated, transport, progress, suppliedId) {
  const id = suppliedId || body.id || crypto.randomUUID();
  const started = Date.now();
  const controller = new AbortController();
  active.set(id, controller);
  const prompt = String(body.prompt || '').trim();
  db.prepare("INSERT OR IGNORE INTO ai_generations(id,provider,model,prompt,status,media_type,assets,metadata) VALUES(?,?,?,?,'Preparing',?,?,?)")
    .run(id, validated.provider, validated.row.default_model, prompt, validated.mediaType, JSON.stringify(body.assets || []), JSON.stringify(body.metadata || {}));
  try {
    progress('Generating', id);
    const result = validated.mediaType === 'text'
      ? await dynamicAi.executeMessages(db, body.messages || [{ role: 'user', content: prompt }], transport, { signal: controller.signal })
      : await dynamicAi.executeImage(db, prompt, { size: body.size || body.resolution || body.metadata?.resolution, assets: body.assets || body.referenceAssets, signal: controller.signal }, transport);
    if (controller.signal.aborted) throw new Error('Generation dibatalkan.');
    const media = validated.mediaType === 'image' ? [{ url: result.url, b64_json: result.b64Json, mime_type: 'image/png' }] : [];
    const metadata = { ...JSON.parse(generation(db, id).metadata || '{}'), provider: result.provider, providerId: result.providerId, model: result.model, responseTime: result.responseTime };
    db.prepare("UPDATE ai_generations SET provider=?,model=?,status='Completed',output=?,media=?,metadata=?,duration_ms=?,response_time=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(result.providerId, result.model, result.text || '', JSON.stringify(media), JSON.stringify(metadata), Date.now() - started, new Date().toISOString(), id);
    progress('Completed', id);
    return generation(db, id);
  } catch (error) {
    const status = controller.cancelled ? 'Cancelled' : 'Failed';
    db.prepare("UPDATE ai_generations SET status=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, error.message, id);
    progress(status, id);
    if (controller.cancelled) return generation(db, id);
    throw error;
  } finally { active.delete(id); }
}

function updateStatus(db, id, status) { db.prepare('UPDATE ai_generations SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id); }
function generation(db, id) { return db.prepare('SELECT * FROM ai_generations WHERE id=?').get(id); }
function estimate(provider, usage) { const perMillion = { openai: 0.6, claude: 3, gemini: 0.35 }[provider] || 0; return Number(((usage.totalTokens / 1e6) * perMillion).toFixed(8)); }
function cancel(id) { const controller = active.get(id); if (!controller) return false; controller.cancelled = true; controller.abort(); return true; }
function markCancelled(db, id) { return db.prepare("UPDATE ai_generations SET status='Cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('Completed','Failed','Cancelled')").run(id).changes > 0; }

module.exports = { seed, setting, save, configuredProviders, validateGeneration, validBaseUrl, CAPABILITIES, execute, generation, cancel, markCancelled };
