PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  request_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('low','medium','high')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS onboarding_workflows (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('running','attention','completed','paused','closed')),
  started_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_events_type_created ON activity_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_user_created ON activity_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_request ON activity_events(request_id);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_created ON notification_outbox(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_kind_created ON notification_outbox(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_workflows_status_checked ON onboarding_workflows(status, last_checked_at ASC);

PRAGMA optimize;
