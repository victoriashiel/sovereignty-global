-- Apply to databases created by the legacy schema before deploying this release.
-- SQLite cannot add foreign keys/check constraints in place; export/rebuild legacy
-- tables using schema.sql in a maintenance window, then preserve the data.
ALTER TABLE documents ADD COLUMN linked_request_id TEXT REFERENCES document_requests(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN object_status TEXT NOT NULL DEFAULT 'available' CHECK(object_status IN ('pending','available','failed'));
ALTER TABLE staff_users ADD COLUMN role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('manager','operator','viewer'));
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, actor_staff_id TEXT, action TEXT NOT NULL, target_type TEXT NOT NULL,
  target_id TEXT, metadata TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_failures (
  subject_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, window_started_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_user_available ON documents(user_id, object_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_user_created ON document_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_request ON documents(linked_request_id);
