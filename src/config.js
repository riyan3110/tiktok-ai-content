const path = require('node:path');
require('dotenv').config();

const root = path.resolve(__dirname, '..');

const supportedAiProviders = ['gemini', 'groq', 'openai'];
const supportedTopicModes = ['manual', 'ai', 'trending'];

function validateAiConfig(config) {
  const missing = [
    ['AI_API_KEY', config.aiApiKey],
    ['AI_BASE_URL', config.aiBaseUrl],
    ['AI_MODEL', config.aiModel]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (!supportedAiProviders.includes(config.aiProvider)) {
    throw new Error(`AI_PROVIDER tidak valid: "${config.aiProvider || ''}". Gunakan salah satu: ${supportedAiProviders.join(', ')}`);
  }
  if (missing.length) throw new Error(`Konfigurasi AI belum lengkap. Isi environment variable: ${missing.join(', ')}`);
  try {
    new URL(config.aiBaseUrl);
  } catch {
    throw new Error('AI_BASE_URL tidak valid. Gunakan URL lengkap, misalnya https://api.openai.com/v1');
  }
}

const config = {
  root,
  port: Number(process.env.PORT || 3000),
  databasePath: process.env.DATABASE_PATH || path.join(root, 'data', 'app.db'),
  aiProvider: (process.env.AI_PROVIDER || '').toLowerCase(),
  aiApiKey: process.env.AI_API_KEY,
  aiBaseUrl: process.env.AI_BASE_URL,
  aiModel: process.env.AI_MODEL,
  tiktokClientKey: process.env.TIKTOK_CLIENT_KEY,
  tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET,
  tiktokRedirectUri: process.env.TIKTOK_REDIRECT_URI,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me',
  appAuthEnabled: process.env.AIADSLAB_AUTH_ENABLED === 'true',
  appAuthUsername: process.env.AIADSLAB_AUTH_USERNAME || '',
  appAuthPassword: process.env.AIADSLAB_AUTH_PASSWORD || '',
  appAuthDays: Number(process.env.AIADSLAB_AUTH_DAYS || 180),
  cronSchedule: process.env.CRON_SCHEDULE || '0 9 * * *',
  cronTimezone: process.env.CRON_TIMEZONE || 'Asia/Jakarta',
  enableCron: process.env.ENABLE_CRON === 'true',
  dailyTopicMode: (process.env.DAILY_TOPIC_MODE || 'ai').toLowerCase(),
  dailyManualTopic: process.env.DAILY_MANUAL_TOPIC || '',
  trendingApiUrl: process.env.TRENDING_API_URL || '',
  trendingApiKey: process.env.TRENDING_API_KEY || '',
  watermarkEnabled: process.env.WATERMARK_ENABLED !== 'false',
  watermarkText: process.env.WATERMARK_TEXT || 'AI ADS LAB',
  watermarkOpacity: Number(process.env.WATERMARK_OPACITY || 0.4),
  watermarkPosition: process.env.WATERMARK_POSITION || 'top-left',
  watermarkFontSize: Number(process.env.WATERMARK_FONT_SIZE || 28)
};

if (!supportedTopicModes.includes(config.dailyTopicMode)) {
  throw new Error(`DAILY_TOPIC_MODE tidak valid: "${config.dailyTopicMode}". Gunakan salah satu: ${supportedTopicModes.join(', ')}`);
}

module.exports = { ...config, validateAiConfig: () => validateAiConfig(config), validateAiConfigValues: validateAiConfig };
