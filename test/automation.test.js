const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/db');
const automation = require('../src/services/automation');

function deps(overrides = {}) {
  let generated = 0;
  return {
    content: { generateAngles: async (_, count) => Array.from({ length: count }, (x, i) => `Sudut unik ${i + 1}`), generateContent: async (_, options) => ({ topic: `Judul ${++generated}: ${options.requestedTopic}`, hook: `Hook ${generated}`, body: `Bahasan unik ${generated}`, caption: `Caption ${generated}`, hashtags: ['#AI'], cta: `CTA ${generated}` }) },
    images: { createSlides: async id => [`/generated/${id}.jpg`], validateSlides: async () => {} },
    tiktok: { validateImageUrls: async () => {}, publishPhotos: async () => ({ data: { publish_id: `pub-${generated}` } }), status: async () => ({ data: { status: 'SEND_TO_USER_INBOX' } }), refresh: async () => ({ access_token: 'fresh', expires_in: 3600 }) },
    ...overrides
  };
}
async function scheduled(db, custom = {}) { return automation.createSchedule(db, { mainTopic: 'Tips membuat konten dengan AI', totalContents: 3, times: ['09:00', '13:00', '19:00'], category: 'Tutorial AI', contentFormat: 'Tutorial langkah', ...custom }, custom.deps || deps()); }
function token(db, expires = Date.now() + 3600000) { db.prepare("INSERT INTO oauth_tokens(provider,access_token,refresh_token,expires_at,refresh_expires_at) VALUES('tiktok','old','refresh',?,?)").run(expires, Date.now() + 86400000); }

test('membuat tiga sudut dan konten yang berbeda dari satu topik tanpa duplikat', async () => {
  const db = createDatabase(':memory:'); const d = deps(); const schedule = await scheduled(db, { deps: d }); token(db);
  db.prepare('UPDATE automation_jobs SET scheduled_at=?').run(Date.now()); await automation.tick(db, d);
  const rows = db.prepare('SELECT topic,hook,caption,cta,main_topic,content_angle FROM contents').all();
  assert.equal(rows.length, 3); for (const key of ['topic', 'hook', 'caption', 'cta', 'content_angle']) assert.equal(new Set(rows.map(x => x[key])).size, 3);
  assert.ok(rows.every(x => x.main_topic === schedule.main_topic));
});
test('menolak sudut pembahasan duplikat', async () => { const db = createDatabase(':memory:'); await assert.rejects(() => scheduled(db, { deps: deps({ content: { generateAngles: async () => ['Sama', 'Sama', 'Lain'] } }) }), /unik/); });
test('mengubah jam Asia Jakarta menjadi waktu UTC yang benar', () => { assert.equal(new Date(automation.jakartaTimestamp('2026-07-29', '09:00')).toISOString(), '2026-07-29T02:00:00.000Z'); });
test('atomic claim mencegah job dikirim dua kali', async () => { const db = createDatabase(':memory:'); let sends = 0; const d = deps(); d.tiktok.publishPhotos = async () => ({ data: { publish_id: `pub-${++sends}` } }); await scheduled(db, { totalContents: 1, times: ['09:00'], deps: d }); token(db); db.prepare('UPDATE automation_jobs SET scheduled_at=?').run(Date.now()); await Promise.all([automation.tick(db, d), automation.tick(db, d)]); assert.equal(sends, 1); });
test('jadwal tetap tersimpan setelah database dibuka ulang', async () => { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'automation-')), 'app.db'); let db = createDatabase(file); await scheduled(db, { deps: deps() }); db.close(); db = createDatabase(file); assert.equal(automation.listToday(db).length, 1); db.close(); fs.rmSync(path.dirname(file), { recursive: true }); });
test('membatalkan satu job tidak membatalkan job lain', async () => { const db = createDatabase(':memory:'); const s = await scheduled(db); automation.setJobStatus(db, s.jobs[0].id, 'CANCELLED'); const jobs = automation.getSchedule(db, s.id).jobs; assert.equal(jobs[0].status, 'CANCELLED'); assert.equal(jobs[1].status, 'WAITING'); });
test('menghentikan seluruh jadwal membatalkan semua job menunggu', async () => { const db = createDatabase(':memory:'); const s = await scheduled(db); automation.scheduleAction(db, s.id, 'cancel'); assert.ok(automation.getSchedule(db, s.id).jobs.every(x => x.status === 'CANCELLED')); });
test('token TikTok kedaluwarsa di-refresh sebelum pengiriman', async () => { const db = createDatabase(':memory:'); let refreshed = 0; const d = deps(); d.tiktok.refresh = async () => { refreshed++; return { access_token: 'fresh', expires_in: 3600 }; }; await scheduled(db, { totalContents: 1, times: ['09:00'], deps: d }); token(db, Date.now() - 1); db.prepare('UPDATE automation_jobs SET scheduled_at=?').run(Date.now()); await automation.tick(db, d); assert.equal(refreshed, 1); assert.equal(db.prepare("SELECT access_token FROM oauth_tokens WHERE provider='tiktok'").get().access_token, 'fresh'); });
test('kegagalan satu job tidak menghentikan job lain dan retry dibatasi sekali', async () => { const db = createDatabase(':memory:'); const d = deps(); let calls = 0; d.tiktok.publishPhotos = async () => { if (++calls === 1) throw new Error('gangguan sementara'); return { data: { publish_id: 'ok' } }; }; await scheduled(db, { totalContents: 2, times: ['09:00', '13:00'], deps: d }); token(db); db.prepare('UPDATE automation_jobs SET scheduled_at=?').run(Date.now()); await automation.tick(db, d); const jobs = db.prepare('SELECT status,attempt_count,error_message FROM automation_jobs ORDER BY id').all(); assert.equal(jobs[0].status, 'WAITING'); assert.equal(jobs[0].attempt_count, 1); assert.equal(jobs[1].status, 'SEND_TO_USER_INBOX'); });
test('job yang terputus saat restart dikembalikan ke antrean', async () => { const db = createDatabase(':memory:'); const s = await scheduled(db); db.prepare("UPDATE automation_jobs SET status='GENERATING' WHERE id=?").run(s.jobs[0].id); assert.equal(automation.recoverInterruptedJobs(db), 1); assert.equal(db.prepare('SELECT status FROM automation_jobs WHERE id=?').get(s.jobs[0].id).status, 'WAITING'); });
test('polling memperbarui job menjadi SEND_TO_USER_INBOX', async () => { const db = createDatabase(':memory:'); const d = deps(); await scheduled(db, { totalContents: 1, times: ['09:00'], deps: d }); token(db); db.prepare('UPDATE automation_jobs SET scheduled_at=?').run(Date.now()); await automation.tick(db, d); await automation.tick(db, d); assert.equal(db.prepare('SELECT status FROM automation_jobs').get().status, 'SEND_TO_USER_INBOX'); });
