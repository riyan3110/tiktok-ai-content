const cron = require('node-cron');
const config = require('./config');
const { createDatabase } = require('./db');
const { createApp } = require('./app');
const content = require('./services/content');
const images = require('./services/images');
const trending = require('./services/trendingTopics');
const { generateAndSave } = require('./services/generation');

const db = createDatabase(); const app = createApp({ db });
if (config.enableCron) cron.schedule(config.cronSchedule, async () => { try { await generateAndSave({ db, content, images, trending, mode: config.dailyTopicMode, requestedTopic: config.dailyManualTopic }); } catch (e) { console.error('Cron gagal:', e); } }, { timezone: config.cronTimezone });
app.listen(config.port, () => console.log(`TikTok AI Content aktif di http://localhost:${config.port}`));
