const cron = require('node-cron');
const config = require('./config');
const { createDatabase } = require('./db');
const { createApp } = require('./app');
const content = require('./services/content');
const images = require('./services/images');
const trending = require('./services/trendingTopics');
const { generateAndSave } = require('./services/generation');
const automation = require('./services/automation');

const db = createDatabase(); const app = createApp({ db });
automation.recoverInterruptedJobs(db);
if (config.enableCron) cron.schedule(config.cronSchedule, async () => { try { await generateAndSave({ db, content, images, trending, mode: config.dailyTopicMode, requestedTopic: config.dailyManualTopic }); } catch (e) { console.error('Cron gagal:', e); } }, { timezone: config.cronTimezone });
let automationRunning = false;
async function runAutomation() { if (automationRunning) return; automationRunning = true; try { await automation.tick(db); } catch (e) { console.error('Scheduler otomatis gagal:', e); } finally { automationRunning = false; } }
runAutomation();
setInterval(runAutomation, 30 * 1000).unref();
app.listen(config.port, () => console.log(`TikTok AI Content aktif di http://localhost:${config.port}`));
