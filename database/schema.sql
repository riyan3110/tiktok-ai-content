CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL UNIQUE,
  topic_source TEXT NOT NULL DEFAULT 'ai',
  requested_topic TEXT,
  main_topic TEXT,
  content_angle TEXT,
  primary_tool TEXT,
  hook_pattern TEXT,
  similarity_score REAL NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS ai_provider_settings (
  provider TEXT PRIMARY KEY,
  api_key_encrypted TEXT,
  base_url TEXT NOT NULL,
  organization_id TEXT,
  region TEXT,
  default_model TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  retry_count INTEGER NOT NULL DEFAULT 2,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_generations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  media_type TEXT NOT NULL DEFAULT 'text',
  assets TEXT NOT NULL DEFAULT '[]',
  media TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  provider_job_id TEXT,
  duration_ms INTEGER,
  error_type TEXT,
  error_message TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  request_time TEXT,
  response_time TEXT,
  endpoint TEXT,
  prompt_size INTEGER NOT NULL DEFAULT 0,
  output_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_provider_health (
  provider TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'Offline',
  latency_ms INTEGER,
  last_success TEXT,
  last_failure TEXT,
  quota_status TEXT NOT NULL DEFAULT 'Unknown',
  provider_version TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  target_ai TEXT NOT NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  character_data TEXT NOT NULL DEFAULT '{}',
  product_data TEXT NOT NULL DEFAULT '{}',
  reference_images TEXT NOT NULL DEFAULT '[]',
  style TEXT,
  camera TEXT,
  lighting TEXT,
  voice TEXT,
  duration INTEGER,
  resolution TEXT,
  aspect_ratio TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  seed INTEGER,
  temperature REAL,
  notes TEXT,
  variables TEXT NOT NULL DEFAULT '{}',
  folder TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_preset INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_templates_library ON templates(is_archived, is_favorite, category, folder);

CREATE TABLE IF NOT EXISTS template_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(template_id, version)
);

CREATE TABLE IF NOT EXISTS template_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name TEXT,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS template_runs (
  id TEXT PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  generation_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  duration_ms INTEGER,
  cost REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Queued',
  mode TEXT NOT NULL DEFAULT 'once',
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_template_runs_history ON template_runs(template_id, created_at DESC);
