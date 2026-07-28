const cron = require('node-cron');
const config = require('./config');
const { createDatabase } = require('./db');
const { createApp } = require('./app');
const content = require('./services/content');
const images = require('./services/images');

const db = createDatabase(); const app = createApp({ db });
if (config.enableCron) cron.schedule(config.cronSchedule, async () => { try { const topics = db.prepare('SELECT topic FROM contents ORDER BY id DESC LIMIT 50').all().map(x => x.topic); const c = await content.generateContent(topics); const r = db.prepare('INSERT INTO contents(topic,hook,body,caption,hashtags,cta) VALUES(?,?,?,?,?,?)').run(c.topic,c.hook,c.body,c.caption,JSON.stringify(c.hashtags),c.cta); const slides = await images.createSlides(r.lastInsertRowid,c); db.prepare('UPDATE contents SET slides=? WHERE id=?').run(JSON.stringify(slides),r.lastInsertRowid); } catch (e) { console.error('Cron gagal:', e); } }, { timezone: config.cronTimezone });
app.listen(config.port, () => console.log(`TikTok AI Content aktif di http://localhost:${config.port}`));
