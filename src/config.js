const path = require('node:path');
require('dotenv').config();

const root = path.resolve(__dirname, '..');

module.exports = {
  root,
  port: Number(process.env.PORT || 3000),
  databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'app.db'),
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  tiktokClientKey: process.env.TIKTOK_CLIENT_KEY,
  tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET,
  tiktokRedirectUri: process.env.TIKTOK_REDIRECT_URI,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me',
  cronSchedule: process.env.CRON_SCHEDULE || '0 9 * * *',
  cronTimezone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',
  enableCron: process.env.ENABLE_CRON === 'true'
};
