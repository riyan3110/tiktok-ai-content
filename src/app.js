const express = require('express');
const crypto = require('node:crypto');
const session = require('express-session');
const config = require('./config');
const contentService = require('./services/content');
const imageService = require('./services/images');
const tiktokService = require('./services/tiktok');
const trendingService = require('./services/trendingTopics');
const { generateAndSave } = require('./services/generation');
const historyService = require('./services/history');
const automationService = require('./services/automation');
const trendReferences = require('./services/trendReferences');
const aiConnector = require('./ai/connector');
const { ProviderFactory } = require('./providers');
const { normalizeError } = require('./ai/errors');
const { MediaGenerationWorker } = require('./ai/mediaWorker');
const templateService = require('./services/templates');
const { StorageService } = require('./storage/service');
const { ContentStudioService } = require('./services/contentStudio');

function createApp({ db, content = contentService, images = imageService, tiktok = tiktokService, trending = trendingService, automation = automationService, aiTransport, storageTransport } = {}) {
  const app = express(); app.set('trust proxy', 1); app.use(express.json({ limit: '50mb' })); app.use(express.urlencoded({ extended: false, limit: '50mb' }));
  const oauthLog = (stage, details = {}) => console.info('[TikTok OAuth]', stage, details);
  const stateFingerprint = state => state ? crypto.createHash('sha256').update(state).digest('hex').slice(0, 12) : null;
  const mediaWorker = new MediaGenerationWorker({ db, transport: aiTransport });
  const storage = new StorageService({ db, transport: storageTransport });
  const studio = new ContentStudioService({ db, storage });
  db.prepare("UPDATE ai_generations SET status='Failed',error_type='Interrupted',error_message='Generation terhenti karena server direstart',updated_at=CURRENT_TIMESTAMP WHERE status IN ('Queued','Preparing','Uploading','Generating','Waiting','Receiving','Downloading','Rendering','Retrying')").run();
  mediaWorker.onCompleted = id => studio.persistResult(id);
  app.use(session({ secret: config.sessionSecret, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 15 * 60 * 1000 } }));
  app.use(express.static(`${config.root}/public`, { setHeaders: (res, file) => { if (/\.jpe?g$/i.test(file)) res.setHeader('Content-Type', 'image/jpeg'); } }));
  app.get('/terms', (req, res) => res.sendFile(`${config.root}/public/terms.html`));
  app.get('/privacy', (req, res) => res.sendFile(`${config.root}/public/privacy.html`));
  app.use('/asset-files', express.static(`${config.root}/data/assets`, { fallthrough: false, maxAge: '1h' }));
  app.get('/api/storage/settings', (req, res) => res.json(storage.publicSettings()));
  app.get('/api/content-studio/providers', (req, res) => res.json(studio.providers()));
  app.get('/api/content-studio/jobs', (req, res) => res.json(studio.list(req.query)));
  app.get('/api/content-studio/jobs/:id', (req, res) => { const job = studio.get(req.params.id); res.status(job ? 200 : 404).json(job || { error: 'Job tidak ditemukan' }); });
  app.post('/api/content-studio/generate', async (req, res, next) => { try { const validation = aiConnector.validateGeneration(db, req.body); const count = validation.count; const ids = []; const selected = req.body?.assetIds?.length ? await storage.resolveIds(req.body.assetIds) : (req.body?.assets || []); const assets = selected.map(asset => ({ id: asset.id, type: asset.type === 'video' ? 'video' : 'image', name: asset.name, mimeType: asset.mime_type || asset.mimeType, url: asset.url })); aiConnector.validateGeneration(db, { ...req.body, provider: validation.provider, assets }); for (let index = 0; index < count; index += 1) { const id = crypto.randomUUID(); const job = { ...req.body, provider: validation.provider, id, assets, count, metadata: { negativePrompt: req.body?.negativePrompt || '', resolution: req.body?.resolution || '', batchIndex: index + 1 } }; studio.createQueued(id, job); ids.push(id); mediaWorker.enqueue(job); } res.status(202).json({ ids, status: 'Queued', provider: validation.provider }); } catch (e) { next(e); } });
  app.post('/api/content-studio/jobs/:id/retry', (req, res, next) => { try { const old = studio.get(req.params.id); if (!old) return res.status(404).json({ error: 'Job tidak ditemukan' }); const body = { provider: old.provider, model: old.model || undefined, prompt: old.prompt, negativePrompt: old.negative_prompt, mediaType: old.media_type, assets: old.assets, resolution: old.resolution, metadata: { ...old.metadata, retryOf: old.id } }; const validation = aiConnector.validateGeneration(db, body); const id = crypto.randomUUID(); studio.createQueued(id, { ...body, provider: validation.provider }); mediaWorker.enqueue({ ...body, id, provider: validation.provider }); res.status(202).json({ id, status: 'Queued' }); } catch (e) { next(e); } });
  app.post('/api/content-studio/jobs/:id/duplicate', (req, res, next) => { try { const old = studio.get(req.params.id); if (!old) return res.status(404).json({ error: 'Job tidak ditemukan' }); const body = { provider: old.provider, model: old.model || undefined, prompt: old.prompt, negativePrompt: old.negative_prompt, mediaType: old.media_type, assets: old.assets, resolution: old.resolution, metadata: { ...old.metadata, duplicateOf: old.id } }; aiConnector.validateGeneration(db, body); const id = crypto.randomUUID(); studio.createQueued(id, body); mediaWorker.enqueue({ ...body, id }); res.status(202).json({ id, status: 'Queued' }); } catch (e) { next(e); } });
  app.delete('/api/content-studio/jobs/:id', async (req, res, next) => { try { res.json({ deleted: await studio.remove(req.params.id) }); } catch (e) { next(e); } });
  app.get('/api/content-studio/jobs/:id/download', async (req, res, next) => { try { const file = await studio.download(req.params.id); if (!file) return res.status(404).json({ error: 'File hasil tidak ditemukan' }); res.set({ 'Content-Type': file.mimeType, 'Content-Disposition': `attachment; filename="${file.name.replace(/"/g, '')}"` }).send(file.data); } catch (e) { next(e); } });
  app.put('/api/storage/settings', (req, res, next) => { try { res.json(storage.saveSettings(req.body || {})); } catch (e) { next(e); } });
  app.post('/api/storage/test', async (req, res, next) => { try { res.json(await storage.test()); } catch (e) { next(e); } });
  app.get('/api/assets', async (req, res, next) => { try { res.json(await storage.accessibleList(req.query)); } catch (e) { next(e); } });
  app.post('/api/assets/resolve', async (req, res, next) => { try { res.json(await storage.resolveIds(req.body?.assetIds)); } catch (e) { next(e); } });
  app.get('/api/assets/:id', async (req, res, next) => { try { const asset = storage.repository.get(req.params.id); if (!asset) return res.status(404).json({ error: 'Asset tidak ditemukan' }); res.json(await storage.accessible(asset)); } catch (e) { next(e); } });
  app.get('/api/assets/:id/preview', async (req, res, next) => { try { const asset = storage.repository.get(req.params.id); if (!asset) return res.status(404).json({ error: 'Asset tidak ditemukan' }); const preview = await storage.preview(asset); res.set({ 'Content-Type': preview.mimeType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=300' }).send(preview.data); } catch (e) { next(e); } });
  app.post('/api/assets/upload', async (req, res, next) => { try { const body = req.body || {}; const asset = await storage.upload({ ...body, data: body.data }); res.status(201).json(await storage.accessible(asset)); } catch (e) { next(e); } });
  app.patch('/api/assets/:id', async (req, res, next) => { try { res.json(await storage.move(req.params.id, req.body || {})); } catch (e) { next(e); } });
  app.post('/api/assets/:id/copy', async (req, res, next) => { try { res.status(201).json(await storage.copy(req.params.id)); } catch (e) { next(e); } });
  app.post('/api/assets/bulk-delete', async (req, res, next) => { try { const result = await storage.deleteMany(req.body?.assetIds, { permanent: req.body?.permanent !== false }); res.status(result.failed.length ? 207 : 200).json(result); } catch (e) { next(e); } });
  app.delete('/api/assets/:id', async (req, res, next) => { try { const permanent = req.query.permanent === 'true'; const deleted = await storage.delete(req.params.id, { permanent }); res.status(deleted ? 200 : 404).json({ deleted, permanent }); } catch (e) { next(e); } });
  app.post('/api/assets/:id/restore', (req, res) => res.json({ restored: Boolean(storage.repository.restore(req.params.id)) }));
  app.get('/api/asset-folders', (req, res) => res.json(db.prepare('SELECT * FROM asset_folders ORDER BY name').all()));
  app.post('/api/asset-folders', (req, res, next) => { try { const id = crypto.randomUUID(); const name = String(req.body?.name || '').trim(); if (!name) throw Object.assign(new Error('Nama folder wajib diisi'), { status: 422 }); db.prepare('INSERT INTO asset_folders(id,name,parent_id) VALUES(?,?,?)').run(id, name, req.body?.parentId || null); res.status(201).json(db.prepare('SELECT * FROM asset_folders WHERE id=?').get(id)); } catch (e) { next(e); } });
  app.patch('/api/asset-folders/:id', (req, res) => { const result = db.prepare('UPDATE asset_folders SET name=COALESCE(?,name),parent_id=COALESCE(?,parent_id),is_favorite=COALESCE(?,is_favorite),updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body?.name || null, req.body?.parentId || null, req.body?.favorite === undefined ? null : Number(Boolean(req.body.favorite)), req.params.id); res.status(result.changes ? 200 : 404).json({ updated: Boolean(result.changes) }); });
  app.delete('/api/asset-folders/:id', (req, res) => res.json({ deleted: Boolean(db.prepare('DELETE FROM asset_folders WHERE id=?').run(req.params.id).changes) }));
  app.get('/auth/tiktok', (req, res, next) => {
    const redirectUri = config.tiktokRedirectUri || `${req.protocol}://${req.get('host')}/auth/tiktok/callback`;
    const state = tiktok.randomState(redirectUri); const now = Date.now();
    try {
      new URL(redirectUri);
      oauthLog('state generated', { state: stateFingerprint(state), redirectUri });
      db.transaction(() => {
        db.prepare("DELETE FROM oauth_states WHERE provider='tiktok'").run();
        db.prepare("INSERT INTO oauth_states(state,provider,status,expires_at,redirect_uri) VALUES(?,'tiktok','pending',?,?)").run(state, now + 15 * 60 * 1000, redirectUri);
      })();
      oauthLog('state stored', { state: stateFingerprint(state), storage: 'database', expiresAt: now + 15 * 60 * 1000 });
      req.session.oauthState = state;
      req.session.save(error => {
        if (error) { console.error('[TikTok OAuth] state session save failed', { cause: error.message }); return next(error); }
        const authorizationUrl = tiktok.authorizationUrl(state, redirectUri);
        oauthLog('redirect', { state: stateFingerprint(state), redirectUri, destination: String(authorizationUrl).split('?')[0] });
        return res.redirect(authorizationUrl);
      });
    } catch (error) {
      console.error('[TikTok OAuth] start failed', { cause: error.message, redirectUri });
      next(error);
    }
  });
  app.get('/auth/tiktok/callback', async (req, res, next) => {
    const state = String(req.query.state || ''); const code = String(req.query.code || ''); const now = Date.now();
    try {
      oauthLog('callback received', { state: stateFingerprint(state), hasCode: Boolean(code), providerError: req.query.error || null });
      const saved = state && db.prepare("SELECT * FROM oauth_states WHERE state=? AND provider='tiktok'").get(state);
      const failure = req.query.error ? `TikTok menolak otorisasi: ${req.query.error_description || req.query.error}`
        : !state ? 'parameter state tidak ada pada callback'
          : !saved ? 'state callback tidak ditemukan di penyimpanan persisten'
            : saved.expires_at < now ? 'state callback sudah kedaluwarsa'
              : !code ? 'authorization code tidak ada pada callback'
                : null;
      oauthLog('state compare', {
        state: stateFingerprint(state),
        databaseMatch: Boolean(saved),
        sessionMatch: Boolean(req.session.oauthState && req.session.oauthState === state),
        sessionAvailable: Boolean(req.session.oauthState),
        result: failure || 'match'
      });
      if (failure) {
        console.error('[TikTok OAuth] validation failed', { cause: failure, state: stateFingerprint(state) });
        if (saved) db.prepare("DELETE FROM oauth_states WHERE state=?").run(state);
        return redirectOAuthError(res, failure);
      }
      if (saved.status !== 'pending') {
        console.error('[TikTok OAuth] validation failed', { cause: `state berstatus ${saved.status}, bukan pending`, state: stateFingerprint(state) });
        return redirectOAuthError(res, 'OAuth state sudah digunakan');
      }
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');
      const claimed = db.prepare("DELETE FROM oauth_states WHERE state=? AND provider='tiktok' AND status='pending' AND expires_at>=? RETURNING redirect_uri").get(state, now);
      if (!claimed) {
        console.error('[TikTok OAuth] validation failed', { cause: 'state gagal diklaim secara atomik', state: stateFingerprint(state) });
        return redirectOAuthError(res, 'OAuth state tidak valid atau sudah digunakan');
      }
      try {
        oauthLog('token exchange', { state: stateFingerprint(state), redirectUri: claimed.redirect_uri });
        const token = await tiktok.exchangeCode(code, claimed.redirect_uri);
        if (!token?.access_token || !Number.isFinite(Number(token.expires_in))) throw new Error('Respons token TikTok tidak berisi access_token atau expires_in yang valid');
        const account = await tiktok.validateAccessToken(token.access_token);
        if (!account) throw new Error('Token baru tidak dapat divalidasi ke akun TikTok');
        db.transaction(() => {
          db.prepare(`INSERT INTO oauth_tokens(provider,access_token,refresh_token,expires_at,refresh_expires_at,open_id,display_name,scope) VALUES('tiktok',?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,refresh_expires_at=excluded.refresh_expires_at,open_id=excluded.open_id,display_name=excluded.display_name,scope=excluded.scope,updated_at=CURRENT_TIMESTAMP`).run(token.access_token, token.refresh_token || null, now + Number(token.expires_in) * 1000, token.refresh_expires_in ? now + Number(token.refresh_expires_in) * 1000 : null, account.openId, account.displayName, token.scope || null);
        })();
        oauthLog('connected', { state: stateFingerprint(state), tokenStored: true });
        delete req.session.oauthState; return res.redirect('/?oauth=success');
      } catch (error) {
        console.error('[TikTok OAuth] token exchange failed', { cause: error.message, state: stateFingerprint(state), redirectUri: claimed.redirect_uri });
        return redirectOAuthError(res, error.message);
      }
    } catch (e) { next(e); }
  });
  app.get('/api/tiktok/status', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.json(await verifiedTikTokConnection(db, tiktok));
  });
  app.delete('/api/tiktok/connection', (req, res, next) => {
    try {
      db.transaction(() => {
        db.prepare("DELETE FROM oauth_tokens WHERE provider='tiktok'").run();
        db.prepare("DELETE FROM oauth_states WHERE provider='tiktok'").run();
      })();
      delete req.session.oauthState;
      req.session.save(error => error ? next(error) : res.json({ disconnected: true }));
    } catch (error) { next(error); }
  });
  app.get('/trend-references/current', (req, res) => res.json(trendReferences.current(db)));
  const providersResponse = () => { aiConnector.seed(db); const health = new Map(db.prepare('SELECT * FROM ai_provider_health').all().map(x => [x.provider, x])); return db.prepare('SELECT * FROM ai_provider_settings ORDER BY provider').all().map(row => ({ ...aiConnector.publicSetting(row), health: health.get(row.provider) || { status: 'Offline', quota_status: 'Unknown' } })); };
  app.get('/api/providers', (req, res) => res.json(providersResponse()));
  app.post('/api/providers/save', (req, res, next) => { try { res.json(aiConnector.save(db, req.body?.provider, req.body || {})); } catch (e) { next(e); } });
  app.post('/api/providers/test', async (req, res, next) => testProvider(req.body?.provider, res, next));
  const enqueueGeneration = mediaType => (req, res, next) => { try { const id = mediaWorker.enqueue({ ...req.body, mediaType }); res.status(202).json({ status: 'Queued', provider: req.body?.provider || null, jobId: id, previewUrl: null, downloadUrl: null, storageUrl: null, metadata: {} }); } catch (e) { next(e); } };
  app.post('/api/generate/image', enqueueGeneration('image'));
  app.post('/api/generate/video', enqueueGeneration('video'));
  app.get('/api/generate/jobs', (req, res) => res.json(studio.list(req.query)));
  app.get('/api/generate/jobs/:id', (req, res) => { const item = studio.get(req.params.id); if (!item) return res.status(404).json({ error: 'Generation not found' }); res.json({ status: item.status, provider: item.provider, jobId: item.id, previewUrl: item.result_url || null, downloadUrl: item.asset_id ? `/api/content-studio/jobs/${item.id}/download` : null, storageUrl: item.result_url || null, metadata: item.metadata, errorMessage: item.error_message || null }); });
  async function testProvider(provider, res, next) { const started = Date.now(); try { const row = aiConnector.setting(db, provider); if (!row.enabled) throw Object.assign(new Error('Provider is disabled'), { status: 409 }); if (!row.api_key_encrypted) throw Object.assign(new Error('API key is required'), { status: 422 }); const adapter = ProviderFactory.create(aiConnector.configured(row), aiTransport); const result = await adapter.testConnection({}); aiConnector.updateHealth(db, row.provider, true, result); res.json(result); } catch (caught) { const error = normalizeError(caught); aiConnector.updateHealth(db, provider, false, { responseTime: Date.now() - started }); next(error); } }
  app.get('/api/ai/providers', (req, res) => { aiConnector.seed(db); const health = new Map(db.prepare('SELECT * FROM ai_provider_health').all().map(x => [x.provider, x])); res.json(db.prepare('SELECT * FROM ai_provider_settings ORDER BY provider').all().map(row => ({ ...aiConnector.publicSetting(row), health: health.get(row.provider) || { status: 'Offline', quota_status: 'Unknown' } }))); });
  app.put('/api/ai/providers/:provider', (req, res, next) => { try { res.json(aiConnector.save(db, req.params.provider, req.body || {})); } catch (e) { next(e); } });
  app.delete('/api/ai/providers/:provider/key', (req, res, next) => { try { res.json(aiConnector.save(db, req.params.provider, { apiKey: '' })); } catch (e) { next(e); } });
  app.post('/api/ai/providers/:provider/test', async (req, res, next) => { const started = Date.now(); try { const row = aiConnector.setting(db, req.params.provider); if (!row.enabled) throw Object.assign(new Error('Provider is disabled'), { status: 409 }); if (!row.api_key_encrypted) throw Object.assign(new Error('API key is required'), { status: 422 }); const adapter = ProviderFactory.create(aiConnector.configured(row), aiTransport); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), row.timeout_ms); try { const result = await adapter.testConnection({ signal: controller.signal }); aiConnector.updateHealth(db, row.provider, true, result); res.json(result); } finally { clearTimeout(timer); } } catch (caught) { const error = normalizeError(caught); aiConnector.updateHealth(db, req.params.provider, false, { responseTime: Date.now() - started }); next(error); } });
  app.post('/api/ai/generations', async (req, res, next) => { try { res.status(202).json(await aiConnector.execute(db, req.body || {}, aiTransport)); } catch (e) { next(e); } });
  app.post('/api/ai/generations/stream', async (req, res) => { res.setHeader('Content-Type', 'application/x-ndjson'); res.setHeader('Cache-Control', 'no-cache'); res.flushHeaders(); const emit = (status, id) => res.write(`${JSON.stringify({ type: 'progress', status, id })}\n`); try { const result = await aiConnector.execute(db, { ...req.body, stream: true }, aiTransport, emit); res.write(`${JSON.stringify({ type: 'result', data: result })}\n`); } catch (error) { res.write(`${JSON.stringify({ type: 'error', error: error.type || 'Unknown Error', message: error.message, id: error.generationId })}\n`); } finally { res.end(); } });
  app.post('/api/ai/generations/:id/cancel', (req, res) => { const cancelled = aiConnector.cancel(req.params.id); res.status(cancelled ? 202 : 404).json({ cancelled }); });
  app.post('/api/ai/generations/batch', (req, res, next) => { try { const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : []; if (!jobs.length || jobs.length > 20) throw Object.assign(new Error('jobs must contain 1 to 20 generation requests'), { status: 422 }); const ids = mediaWorker.enqueueMany(jobs); res.status(202).json({ ids, status: 'Pending' }); } catch (e) { next(e); } });
  app.get('/api/ai/generations/:id', (req, res) => { const item = aiConnector.generation(db, req.params.id); if (!item) return res.status(404).json({ error: 'Generation not found' }); res.json(parseGeneration(item)); });
  app.post('/api/ai/generations/:id/retry', (req, res, next) => { try { const old = aiConnector.generation(db, req.params.id); if (!old) return res.status(404).json({ error: 'Generation not found' }); const id = mediaWorker.enqueue({ provider: old.provider, model: old.model, prompt: old.prompt, mediaType: old.media_type, assets: JSON.parse(old.assets || '[]'), metadata: { retryOf: old.id } }); res.status(202).json({ id, status: 'Pending' }); } catch (e) { next(e); } });
  app.post('/api/ai/generations/:id/continue', (req, res) => { const continued = mediaWorker.continue(req.params.id); res.status(continued ? 202 : 409).json({ continued }); });
  app.post('/api/ai/jobs', (req, res) => { const id = mediaWorker.enqueue(req.body || {}); res.status(202).json({ id, status: 'Pending' }); });
  app.post('/api/ai/jobs/:id/cancel', (req, res) => { const cancelled = mediaWorker.cancel(req.params.id); res.status(cancelled ? 202 : 404).json({ cancelled }); });
  app.get('/api/ai/generations', (req, res) => res.json(db.prepare('SELECT * FROM ai_generations ORDER BY created_at DESC LIMIT 100').all()));
  app.get('/api/ai/health', (req, res) => res.json(db.prepare('SELECT * FROM ai_provider_health ORDER BY provider').all()));
  app.get('/api/templates', (req, res, next) => { try { res.json(templateService.list(db, req.query)); } catch (e) { next(e); } });
  app.get('/api/templates/active-draft', (req, res, next) => { try { const row = db.prepare('SELECT * FROM active_template_drafts WHERE id=1').get(); res.json(row ? { ...row, snapshot: JSON.parse(row.snapshot) } : null); } catch (e) { next(e); } });
  app.get('/api/templates/:id', (req, res, next) => { try { res.json(templateService.get(db, req.params.id)); } catch (e) { next(e); } });
  app.post('/api/templates', (req, res, next) => { try { res.status(201).json(templateService.create(db, req.body || {})); } catch (e) { next(e); } });
  app.post('/api/templates/import', (req, res, next) => { try { const body = req.body?.template || req.body; if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('JSON template tidak valid'), { status: 422 }); const allowed = ['name','category','description','targetAI','target_ai','prompt','negativePrompt','negative_prompt','provider','model','platform','duration','resolution','aspectRatio','aspect_ratio','style','camera','lighting','voice','tags','variables','folder','referenceImages','assets','notes']; const clean = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key))); clean.name = `Copy of ${String(clean.name || '').trim()}`; res.status(201).json(templateService.create(db, clean)); } catch (e) { next(e); } });
  app.put('/api/templates/:id', (req, res, next) => { try { res.json(templateService.update(db, req.params.id, req.body || {})); } catch (e) { next(e); } });
  app.delete('/api/templates/:id', (req, res, next) => { try { res.json(templateService.remove(db, req.params.id)); } catch (e) { next(e); } });
  app.post('/api/templates/:id/duplicate', (req, res, next) => { try { res.status(201).json(templateService.duplicate(db, req.params.id)); } catch (e) { next(e); } });
  app.post('/api/templates/:id/use', (req, res, next) => { try { const item = templateService.get(db, req.params.id); const destination = item.target_ai === 'video' ? 'studio' : item.target_ai === 'workflow' ? 'workflow' : item.target_ai === 'text' ? 'factory' : 'generator'; db.prepare(`INSERT INTO active_template_drafts(id,template_id,destination,snapshot,updated_at) VALUES(1,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET template_id=excluded.template_id,destination=excluded.destination,snapshot=excluded.snapshot,updated_at=CURRENT_TIMESTAMP`).run(item.id, destination, JSON.stringify(item)); res.json({ destination, template: item }); } catch (e) { next(e); } });
  app.get('/api/templates/:id/versions', (req, res, next) => { try { templateService.get(db, req.params.id); res.json(db.prepare('SELECT id,template_id,version,created_at FROM template_versions WHERE template_id=? ORDER BY version DESC').all(Number(req.params.id))); } catch (e) { next(e); } });
  app.get('/api/templates/:id/runs', (req, res, next) => { try { templateService.get(db, req.params.id); res.json(db.prepare('SELECT * FROM template_runs WHERE template_id=? ORDER BY created_at DESC').all(Number(req.params.id))); } catch (e) { next(e); } });
  app.post('/api/templates/:id/preview', (req, res, next) => { try { const item = templateService.get(db, req.params.id); res.json(templateService.preview(item, req.body || {})); } catch (e) { next(e); } });
  app.get('/api/templates/:id/export/:format', (req, res, next) => { try { const item = templateService.get(db, req.params.id); const format = req.params.format; if (!['json', 'markdown', 'txt'].includes(format)) throw Object.assign(new Error('Format export harus json, markdown, atau txt'), { status: 400 }); if (format === 'json') return res.type('json').send(JSON.stringify(item, null, 2)); if (format === 'txt') return res.type('text').send(item.prompt); res.type('text/markdown').send(`# ${item.name}\n\n${item.description || ''}\n\n## Prompt\n\n${item.prompt}\n\n## Negative Prompt\n\n${item.negative_prompt || '-'}\n`); } catch (e) { next(e); } });
  app.post('/api/templates/:id/generate', (req, res, next) => { try {
    const item = templateService.get(db, req.params.id); aiConnector.setting(db, item.provider);
    const preview = templateService.preview(item, req.body?.context || req.body?.variables || {});
    if (preview.unresolved.length) throw Object.assign(new Error(`Variable belum diisi: ${preview.unresolved.join(', ')}`), { status: 422 });
    const mode = req.body?.mode || 'once'; if (!['once', 'batch', 'queue', 'scheduled'].includes(mode)) throw Object.assign(new Error('Mode automation tidak valid'), { status: 422 });
    const count = mode === 'once' ? 1 : Number(req.body?.count || 10); if (!Number.isInteger(count) || count < 1 || count > 100) throw Object.assign(new Error('Batch harus berisi 1 sampai 100 generation'), { status: 422 });
    if (mode === 'scheduled' && !req.body?.scheduledAt) throw Object.assign(new Error('scheduledAt wajib untuk generate berkala'), { status: 422 });
    const ids = []; const insert = db.prepare('INSERT INTO template_runs(id,template_id,generation_id,provider,model,prompt,cost,status,mode,scheduled_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const transaction = db.transaction(() => { for (let index = 0; index < count; index += 1) { const runId = crypto.randomUUID(); const generationId = crypto.randomUUID(); insert.run(runId, item.id, generationId, item.provider, item.model, preview.prompt, preview.estimatedCost, mode === 'scheduled' ? 'Scheduled' : 'Queued', mode, req.body?.scheduledAt || null); ids.push({ runId, generationId }); } }); transaction();
    if (mode !== 'scheduled') ids.forEach(({ generationId }) => {
      const unsubscribe = mediaWorker.subscribe(generationId, event => { const generation = aiConnector.generation(db, generationId); db.prepare('UPDATE template_runs SET status=?,duration_ms=?,cost=?,updated_at=CURRENT_TIMESTAMP WHERE generation_id=?').run(event.status, generation?.duration_ms || null, generation?.estimated_cost || preview.estimatedCost, generationId); if (['Completed', 'Failed', 'Cancelled'].includes(event.status)) unsubscribe(); });
      mediaWorker.enqueue({ id: generationId, provider: item.provider, model: item.model, prompt: preview.prompt, mediaType: item.target_ai, assets: item.assets, seed: item.seed, temperature: item.temperature, metadata: { templateId: item.id, templateVersion: item.version } });
    });
    res.status(202).json({ templateId: item.id, mode, count, jobs: ids, preview });
  } catch (e) { next(e); } });
  app.post('/trend-references', (req, res, next) => { try { res.status(201).json(trendReferences.save(db, req.body || {})); } catch (e) { next(e); } });
  app.put('/trend-references/:id', (req, res, next) => { try { res.json(trendReferences.save(db, req.body || {}, Number(req.params.id))); } catch (e) { next(e); } });
  app.post('/trend-references/:id/disable', (req, res) => { const result = db.prepare('UPDATE trend_reference_sets SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Referensi tidak ditemukan' }); res.json(trendReferences.current(db)); });
  app.delete('/trend-references/:id', (req, res) => { const result = db.prepare('DELETE FROM trend_reference_sets WHERE id=?').run(Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Referensi tidak ditemukan' }); res.json({ deleted: result.changes }); });
  app.post('/generate', async (req, res, next) => { try { const watermark = typeof req.body?.watermarkEnabled === 'boolean' ? { enabled: req.body.watermarkEnabled } : req.body?.watermark; const id = await generateAndSave({ db, content, images, trending, useTrendReference: req.body?.useTrendReference !== false, forceNewAngle: req.body?.forceNewAngle === true, mode: req.body?.topicSource || 'ai', requestedTopic: req.body?.requestedTopic, category: req.body?.contentCategory || 'Iklan & UGC', customCategory: req.body?.customCategory, format: req.body?.contentFormat || 'Tutorial langkah', watermark }); res.json(record(db, id)); } catch (e) { next(e); } });
  app.post('/upload-tiktok', async (req, res, next) => { try { const item = record(db, Number(req.body.id)); if (!item) return res.status(404).json({ error: 'Konten tidak ditemukan' }); const token = await validToken(db, tiktok); if (!token) return res.status(401).json({ error: 'Hubungkan akun TikTok terlebih dahulu' }); await images.validateSlides(item.slides); const imageUrls = item.slides.map(x => `${config.publicBaseUrl}${x}`); if (imageUrls.some(url => !url.startsWith(`${config.publicBaseUrl}/generated/`) || !url.toLowerCase().endsWith('.jpg'))) throw Object.assign(new Error('URL slide TikTok harus memakai prefix publik terverifikasi dan berakhiran .jpg.'), { status: 400 }); await tiktok.validateImageUrls(imageUrls, `${config.publicBaseUrl}/generated/`); const caption = String(req.body.caption || item.caption).trim(); db.prepare('UPDATE contents SET caption=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(caption, item.id); const result = await tiktok.publishPhotos(token.access_token, imageUrls, `${caption}\n\n${item.hashtags.join(' ')}`); const publishId = result.data?.publish_id; db.prepare("UPDATE contents SET publish_id=?,publish_status='PROCESSING_UPLOAD',publish_error=NULL,fail_reason=NULL,downloaded_bytes=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(publishId, item.id); res.json({ publishId, draft: true, status: 'PROCESSING_UPLOAD', fail_reason: null, downloaded_bytes: null }); } catch (e) { next(e); } });
  app.get('/status/:publishId', async (req, res, next) => { try { const token = await validToken(db, tiktok); if (!token) return res.status(401).json({ error: 'TikTok belum terhubung' }); const result = await tiktok.status(token.access_token, req.params.publishId); const data = result.data || {}; const s = data.status || 'UNKNOWN'; db.prepare('UPDATE contents SET publish_status=?,publish_error=?,fail_reason=?,downloaded_bytes=?,updated_at=CURRENT_TIMESTAMP WHERE publish_id=?').run(s, data.fail_reason || null, data.fail_reason || null, data.downloaded_bytes ?? null, req.params.publishId); res.json({ status: s, fail_reason: data.fail_reason || null, downloaded_bytes: data.downloaded_bytes ?? null }); } catch (e) { next(e); } });
  app.get('/history', (req, res) => res.json(db.prepare('SELECT * FROM contents ORDER BY id DESC').all().map(parseRecord)));
  app.delete('/history/:id', async (req, res, next) => { try { res.json(await historyService.deleteOne(db, req.params.id)); } catch (e) { next(e); } });
  app.delete('/history', async (req, res, next) => { try { res.json(await historyService.deleteAll(db)); } catch (e) { next(e); } });
  app.post('/automation/schedules', async (req, res, next) => { try { res.status(201).json(await automation.createSchedule(db, req.body || {}, { content })); } catch (e) { next(e); } });
  app.get('/automation/today', (req, res) => res.json(automation.listToday(db)));
  app.post('/automation/schedules/:id/:action', (req, res, next) => { try { res.json(automation.scheduleAction(db, Number(req.params.id), req.params.action)); } catch (e) { next(e); } });
  app.post('/automation/jobs/:id/:action', async (req, res, next) => { try {
    const id = Number(req.params.id); const action = req.params.action;
    if (action === 'cancel') automation.setJobStatus(db, id, 'CANCELLED');
    else if (action === 'send-now' || action === 'retry') { db.prepare("UPDATE automation_jobs SET status='WAITING',scheduled_at=?,retry_at=NULL,error_message=NULL,attempt_count=CASE WHEN ?='retry' THEN 0 ELSE attempt_count END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('WAITING','FAILED','MISSED')").run(Date.now(), action, id); await automation.tick(db, { content, images, tiktok }); }
    else throw Object.assign(new Error('Aksi job tidak valid'), { status: 400 });
    res.json(db.prepare('SELECT * FROM automation_jobs WHERE id=?').get(id));
  } catch (e) { next(e); } });
  app.use((err, req, res, next) => { if (!err.status || err.status >= 500) console.error(err); res.status(err.status || 500).json({ error: err.message || 'Kesalahan internal', ...(err.unresolvedVariables ? { unresolvedVariables: err.unresolvedVariables } : {}) }); });
  return app;
}
function parseRecord(row) { if (!row) return null; return { ...row, slides: JSON.parse(row.slides), hashtags: JSON.parse(row.hashtags), trend_keywords_used: JSON.parse(row.trend_keywords_used || '[]'), trend_keywords_ignored: JSON.parse(row.trend_keywords_ignored || '[]') }; }
function redirectOAuthError(res, reason) {
  const safeReason = String(reason || 'otorisasi tidak dapat diselesaikan').replace(/[\r\n]/g, ' ').slice(0, 180);
  return res.redirect(`/?oauth=error&reason=${encodeURIComponent(safeReason)}`);
}
function record(db, id) { return parseRecord(db.prepare('SELECT * FROM contents WHERE id=?').get(id)); }
function parseGeneration(row) { if (!row) return null; return { ...row, assets: JSON.parse(row.assets || '[]'), media: JSON.parse(row.media || '[]'), metadata: JSON.parse(row.metadata || '{}') }; }
async function validToken(db, tiktok) { let token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get(); if (!token) return null; if (token.expires_at < Date.now() + 60000) { const next = await tiktok.refresh(token.refresh_token); db.prepare("UPDATE oauth_tokens SET access_token=?,refresh_token=?,expires_at=?,refresh_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE provider='tiktok'").run(next.access_token, next.refresh_token || token.refresh_token, Date.now() + next.expires_in * 1000, Date.now() + (next.refresh_expires_in || 0) * 1000); token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get(); } return token; }

async function verifiedTikTokConnection(db, tiktok) {
  let token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get();
  const disconnected = reason => ({ connected: false, account: null, reason });
  const clear = reason => { db.prepare("DELETE FROM oauth_tokens WHERE provider='tiktok'").run(); return disconnected(reason); };
  if (!token?.access_token) return clear('missing_token');
  if (!Number.isFinite(Number(token.expires_at))) return clear('invalid_token');
  try {
    if (Number(token.expires_at) <= Date.now()) {
      if (!token.refresh_token || (token.refresh_expires_at && Number(token.refresh_expires_at) <= Date.now())) return clear('expired_token');
      const refreshed = await tiktok.refresh(token.refresh_token);
      if (!refreshed?.access_token || !Number.isFinite(Number(refreshed.expires_in))) return clear('expired_token');
      const now = Date.now();
      db.prepare("UPDATE oauth_tokens SET access_token=?,refresh_token=?,expires_at=?,refresh_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE provider='tiktok'").run(refreshed.access_token, refreshed.refresh_token || token.refresh_token, now + Number(refreshed.expires_in) * 1000, refreshed.refresh_expires_in ? now + Number(refreshed.refresh_expires_in) * 1000 : token.refresh_expires_at);
      token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get();
    }
    const verified = await tiktok.validateAccessToken(token.access_token);
    if (!verified) return clear('invalid_token');
    const account = typeof verified === 'object' ? verified : { openId: token.open_id, displayName: token.display_name || token.open_id };
    if (!account.openId) return clear('invalid_token');
    if (account.openId !== token.open_id || account.displayName !== token.display_name) db.prepare("UPDATE oauth_tokens SET open_id=?,display_name=?,updated_at=CURRENT_TIMESTAMP WHERE provider='tiktok'").run(account.openId, account.displayName);
    return { connected: true, account: { displayName: account.displayName || account.openId, openId: account.openId } };
  } catch (_) {
    return clear(Number(token.expires_at) <= Date.now() ? 'expired_token' : 'invalid_token');
  }
}
module.exports = { createApp };
