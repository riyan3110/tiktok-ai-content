const config = require('../config');
const defaultContent = require('./content');
const defaultImages = require('./images');
const defaultTikTok = require('./tiktok');
const { generateAndSave } = require('./generation');
const { resolveCategory, resolveFormat } = require('./contentOptions');

const TIMEZONE = 'Asia/Jakarta';
const NON_RETRYABLE = /spam_risk_too_many_pending_share|access token.*(dicabut|revoked)|izin TikTok|scope|permission/i;
const FINAL = new Set(['SEND_TO_USER_INBOX', 'FAILED', 'CANCELLED', 'MISSED']);

function jakartaDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
function jakartaTimestamp(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw bad('Tanggal atau waktu tidak valid');
  // Jakarta has no daylight-saving time and is always UTC+7.
  return Date.parse(`${date}T${time}:00+07:00`);
}
function bad(message) { return Object.assign(new Error(message), { status: 400 }); }
function parseSchedule(row, jobs) { return { ...row, jobs, progress: { done: jobs.filter(x => x.status === 'SEND_TO_USER_INBOX').length, waiting: jobs.filter(x => ['WAITING', 'GENERATING', 'READY', 'SENDING', 'PROCESSING_DOWNLOAD'].includes(x.status)).length, failed: jobs.filter(x => ['FAILED', 'MISSED'].includes(x.status)).length } }; }

async function createSchedule(db, input, deps = {}) {
  const mainTopic = String(input.mainTopic || '').trim();
  const total = Number(input.totalContents);
  const date = input.scheduledDate || jakartaDate();
  if (!mainTopic) throw bad('Topik utama wajib diisi');
  if (!Number.isInteger(total) || total < 1 || total > 5) throw bad('Jumlah konten harus 1 sampai 5');
  if (!Array.isArray(input.times) || input.times.length !== total) throw bad('Jam setiap konten wajib diisi');
  const timestamps = input.times.map(time => jakartaTimestamp(date, time));
  const sorted = [...timestamps].sort((a, b) => a - b);
  if (sorted.some((time, i) => i && time - sorted[i - 1] < 60 * 60 * 1000)) throw bad('Jarak antarjadwal minimal 60 menit');
  const content = deps.content || defaultContent;
  const category = resolveCategory(input.category || 'Iklan & UGC', input.customCategory);
  const format = resolveFormat(input.contentFormat || 'Tutorial langkah');
  const angles = await content.generateAngles(mainTopic, total, { category, format });
  if (!Array.isArray(angles) || angles.length !== total || new Set(angles.map(x => String(x).trim().toLowerCase())).size !== total) throw new Error('AI tidak menghasilkan sudut pembahasan yang unik');
  const transaction = db.transaction(() => {
    const schedule = db.prepare('INSERT INTO automation_schedules(main_topic,category,content_format,total_contents,scheduled_date,timezone) VALUES(?,?,?,?,?,?)').run(mainTopic, category, format, total, date, TIMEZONE);
    const insert = db.prepare('INSERT INTO automation_jobs(schedule_id,angle,scheduled_at) VALUES(?,?,?)');
    angles.forEach((angle, index) => insert.run(schedule.lastInsertRowid, String(angle).trim(), timestamps[index]));
    return Number(schedule.lastInsertRowid);
  });
  return getSchedule(db, transaction());
}

function getSchedule(db, id) { const row = db.prepare('SELECT * FROM automation_schedules WHERE id=?').get(id); return row && parseSchedule(row, db.prepare('SELECT * FROM automation_jobs WHERE schedule_id=? ORDER BY scheduled_at').all(id)); }
function listToday(db, date = jakartaDate()) { return db.prepare('SELECT * FROM automation_schedules WHERE scheduled_date=? ORDER BY id DESC').all(date).map(row => parseSchedule(row, db.prepare('SELECT * FROM automation_jobs WHERE schedule_id=? ORDER BY scheduled_at').all(row.id))); }
function setJobStatus(db, id, status) { const result = db.prepare("UPDATE automation_jobs SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('WAITING','FAILED','MISSED')").run(status, id); if (!result.changes) throw Object.assign(new Error('Job tidak dapat diubah'), { status: 409 }); }
function scheduleAction(db, id, action) { const statuses = { pause: 'PAUSED', resume: 'ACTIVE', cancel: 'CANCELLED' }; if (!statuses[action]) throw bad('Aksi tidak valid'); db.prepare('UPDATE automation_schedules SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(statuses[action], id); if (action === 'cancel') db.prepare("UPDATE automation_jobs SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE schedule_id=? AND status IN ('WAITING','FAILED','MISSED')").run(id); return getSchedule(db, id); }
function recoverInterruptedJobs(db) { return db.prepare("UPDATE automation_jobs SET status='WAITING',error_message='Proses dilanjutkan setelah server restart',updated_at=CURRENT_TIMESTAMP WHERE status IN ('GENERATING','READY','SENDING')").run().changes; }

async function validToken(db, tiktok) {
  let token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get();
  if (!token) throw new Error('Akun TikTok belum terhubung');
  if (token.expires_at < Date.now() + 60000) {
    if (!token.refresh_token || (token.refresh_expires_at && token.refresh_expires_at < Date.now())) throw new Error('Access token TikTok dicabut atau kedaluwarsa');
    const next = await tiktok.refresh(token.refresh_token);
    db.prepare("UPDATE oauth_tokens SET access_token=?,refresh_token=?,expires_at=?,refresh_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE provider='tiktok'").run(next.access_token, next.refresh_token || token.refresh_token, Date.now() + next.expires_in * 1000, Date.now() + (next.refresh_expires_in || 0) * 1000);
    token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get();
  }
  return token;
}

async function executeJob(db, job, deps = {}) {
  const content = deps.content || defaultContent, images = deps.images || defaultImages, tiktok = deps.tiktok || defaultTikTok;
  try {
    let contentId = job.content_id;
    if (!contentId) {
      contentId = await generateAndSave({ db, content, images, mode: 'manual', requestedTopic: `${job.main_topic} — ${job.angle}`, category: job.category, format: job.content_format, mainTopic: job.main_topic, angle: job.angle });
      db.prepare("UPDATE automation_jobs SET content_id=?,status='READY',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='GENERATING'").run(contentId, job.id);
    }
    const item = db.prepare('SELECT * FROM contents WHERE id=?').get(contentId);
    const slides = JSON.parse(item.slides);
    await images.validateSlides(slides);
    const urls = slides.map(path => `${config.publicBaseUrl}${path}`);
    await tiktok.validateImageUrls(urls, `${config.publicBaseUrl}/generated/`);
    const token = await validToken(db, tiktok);
    if (!db.prepare("UPDATE automation_jobs SET status='SENDING',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('GENERATING','READY')").run(job.id).changes) return;
    const result = await tiktok.publishPhotos(token.access_token, urls, `${item.caption}\n\n${JSON.parse(item.hashtags).join(' ')}`);
    const publishId = result.data?.publish_id;
    db.prepare("UPDATE automation_jobs SET publish_id=?,status='PROCESSING_DOWNLOAD',error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(publishId, job.id);
    db.prepare("UPDATE contents SET publish_id=?,publish_status='PROCESSING_DOWNLOAD',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(publishId, contentId);
  } catch (error) {
    const attempt = job.attempt_count + 1;
    const retry = attempt < 2 && !NON_RETRYABLE.test(error.message);
    db.prepare("UPDATE automation_jobs SET status=?,attempt_count=?,retry_at=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(retry ? 'WAITING' : 'FAILED', attempt, retry ? Date.now() + 10 * 60 * 1000 : null, error.message, job.id);
  }
}

async function tick(db, deps = {}, now = Date.now()) {
  const due = db.prepare("SELECT j.*,s.main_topic,s.category,s.content_format FROM automation_jobs j JOIN automation_schedules s ON s.id=j.schedule_id WHERE s.status='ACTIVE' AND j.status='WAITING' AND j.scheduled_at<=? AND (j.retry_at IS NULL OR j.retry_at<=?) ORDER BY j.scheduled_at").all(now, now);
  for (const job of due) {
    if (now - job.scheduled_at > 30 * 60 * 1000 && !job.retry_at) { db.prepare("UPDATE automation_jobs SET status='MISSED',error_message='Jadwal terlewat lebih dari 30 menit',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='WAITING'").run(job.id); continue; }
    const claimed = db.prepare("UPDATE automation_jobs SET status='GENERATING',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='WAITING'").run(job.id);
    if (claimed.changes) await executeJob(db, { ...job, status: 'GENERATING' }, deps);
  }
  const processing = db.prepare("SELECT j.*,s.status schedule_status FROM automation_jobs j JOIN automation_schedules s ON s.id=j.schedule_id WHERE s.status='ACTIVE' AND j.status='PROCESSING_DOWNLOAD' AND j.publish_id IS NOT NULL").all();
  for (const job of processing) try {
    const token = await validToken(db, deps.tiktok || defaultTikTok); const result = await (deps.tiktok || defaultTikTok).status(token.access_token, job.publish_id); const status = result.data?.status || 'PROCESSING_DOWNLOAD';
    db.prepare('UPDATE automation_jobs SET status=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, result.data?.fail_reason || null, job.id);
    db.prepare('UPDATE contents SET publish_status=?,fail_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, result.data?.fail_reason || null, job.content_id);
  } catch (error) { db.prepare('UPDATE automation_jobs SET error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(error.message, job.id); }
}

module.exports = { TIMEZONE, FINAL, jakartaDate, jakartaTimestamp, createSchedule, getSchedule, listToday, setJobStatus, scheduleAction, recoverInterruptedJobs, tick, validToken };
