CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL UNIQUE,
  topic_source TEXT NOT NULL DEFAULT 'ai',
  requested_topic TEXT,
  main_topic TEXT,
  content_angle TEXT,
  content_category TEXT NOT NULL DEFAULT 'Iklan & UGC',
  content_format TEXT NOT NULL DEFAULT 'Tutorial langkah',
  hook TEXT NOT NULL,
  body TEXT NOT NULL,
  caption TEXT NOT NULL,
  hashtags TEXT NOT NULL,
  cta TEXT NOT NULL,
  slides TEXT NOT NULL DEFAULT '[]',
  publish_id TEXT,
  publish_status TEXT NOT NULL DEFAULT 'generated',
  publish_error TEXT,
  fail_reason TEXT,
  downloaded_bytes INTEGER,
  trend_reference_id INTEGER REFERENCES trend_reference_sets(id) ON DELETE SET NULL,
  trend_keywords_used TEXT NOT NULL DEFAULT '[]',
  trend_keywords_ignored TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trend_reference_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Referensi Tren Hari Ini',
  keywords TEXT NOT NULL,
  keyword_categories TEXT NOT NULL DEFAULT '[]',
  trend_hooks TEXT NOT NULL DEFAULT '[]',
  trend_content_patterns TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'Indonesia',
  intensity TEXT NOT NULL DEFAULT 'Sedang',
  notes TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER,
  open_id TEXT,
  scope TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS automation_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  main_topic TEXT NOT NULL,
  category TEXT NOT NULL,
  content_format TEXT NOT NULL,
  total_contents INTEGER NOT NULL CHECK(total_contents BETWEEN 1 AND 5),
  scheduled_date TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS automation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES automation_schedules(id) ON DELETE CASCADE,
  content_id INTEGER REFERENCES contents(id) ON DELETE SET NULL,
  angle TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING',
  publish_id TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_due ON automation_jobs(status, scheduled_at, retry_at);
