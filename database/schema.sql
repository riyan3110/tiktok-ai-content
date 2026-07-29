CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL UNIQUE,
  topic_source TEXT NOT NULL DEFAULT 'ai',
  requested_topic TEXT,
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
