const express = require('express');
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

function createApp({ db, content = contentService, images = imageService, tiktok = tiktokService, trending = trendingService, automation = automationService } = {}) {
  const app = express(); app.set('trust proxy', 1); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: config.sessionSecret, resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: config.publicBaseUrl.startsWith('https://'), maxAge: 10 * 60 * 1000 } }));
  app.use(express.static(`${config.root}/public`, { setHeaders: (res, file) => { if (/\.jpe?g$/i.test(file)) res.setHeader('Content-Type', 'image/jpeg'); } }));
  app.get('/terms', (req, res) => res.sendFile(`${config.root}/public/terms.html`));
  app.get('/privacy', (req, res) => res.sendFile(`${config.root}/public/privacy.html`));
  app.get('/auth/tiktok', (req, res) => { const state = tiktok.randomState(); req.session.oauthState = state; res.redirect(tiktok.authorizationUrl(state)); });
  app.get('/auth/tiktok/callback', async (req, res, next) => { try { if (!req.query.code || req.query.state !== req.session.oauthState) return res.status(400).send('OAuth state tidak valid.'); const token = await tiktok.exchangeCode(req.query.code); db.prepare(`INSERT INTO oauth_tokens(provider,access_token,refresh_token,expires_at,refresh_expires_at,open_id,scope) VALUES('tiktok',?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,refresh_expires_at=excluded.refresh_expires_at,open_id=excluded.open_id,scope=excluded.scope,updated_at=CURRENT_TIMESTAMP`).run(token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000, Date.now() + token.refresh_expires_in * 1000, token.open_id, token.scope); delete req.session.oauthState; res.redirect('/?oauth=success'); } catch (e) { next(e); } });
  app.get('/tiktok/connection-status', (req, res) => { const token = db.prepare("SELECT 1 FROM oauth_tokens WHERE provider='tiktok'").get(); res.json(token ? { connected: true, message: 'TikTok terhubung' } : { connected: false, message: 'TikTok belum terhubung' }); });
  app.get('/trend-references/current', (req, res) => res.json(trendReferences.current(db)));
  app.post('/trend-references', (req, res, next) => { try { res.status(201).json(trendReferences.save(db, req.body || {})); } catch (e) { next(e); } });
  app.put('/trend-references/:id', (req, res, next) => { try { res.json(trendReferences.save(db, req.body || {}, Number(req.params.id))); } catch (e) { next(e); } });
  app.post('/trend-references/:id/disable', (req, res) => { const result = db.prepare('UPDATE trend_reference_sets SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Referensi tidak ditemukan' }); res.json(trendReferences.current(db)); });
  app.delete('/trend-references/:id', (req, res) => { const result = db.prepare('DELETE FROM trend_reference_sets WHERE id=?').run(Number(req.params.id)); if (!result.changes) return res.status(404).json({ error: 'Referensi tidak ditemukan' }); res.json({ deleted: result.changes }); });
  app.post('/generate', async (req, res, next) => { try { const id = await generateAndSave({ db, content, images, trending, useTrendReference: req.body?.useTrendReference !== false, forceNewAngle: req.body?.forceNewAngle === true, mode: req.body?.topicSource || 'ai', requestedTopic: req.body?.requestedTopic, category: req.body?.contentCategory || 'Iklan & UGC', customCategory: req.body?.customCategory, format: req.body?.contentFormat || 'Tutorial langkah' }); res.json(record(db, id)); } catch (e) { next(e); } });
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
  app.use((err, req, res, next) => { if (!err.status || err.status >= 500) console.error(err); res.status(err.status || 500).json({ error: err.message || 'Kesalahan internal' }); });
  return app;
}
function parseRecord(row) { if (!row) return null; return { ...row, slides: JSON.parse(row.slides), hashtags: JSON.parse(row.hashtags), trend_keywords_used: JSON.parse(row.trend_keywords_used || '[]'), trend_keywords_ignored: JSON.parse(row.trend_keywords_ignored || '[]') }; }
function record(db, id) { return parseRecord(db.prepare('SELECT * FROM contents WHERE id=?').get(id)); }
async function validToken(db, tiktok) { let token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get(); if (!token) return null; if (token.expires_at < Date.now() + 60000) { const next = await tiktok.refresh(token.refresh_token); db.prepare("UPDATE oauth_tokens SET access_token=?,refresh_token=?,expires_at=?,refresh_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE provider='tiktok'").run(next.access_token, next.refresh_token || token.refresh_token, Date.now() + next.expires_in * 1000, Date.now() + (next.refresh_expires_in || 0) * 1000); token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get(); } return token; }
module.exports = { createApp };
