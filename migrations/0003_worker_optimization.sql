PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_users_status_created ON users(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_requests_user_status_updated ON document_requests(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status_updated ON document_requests(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status_created ON documents(object_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_failures_updated ON login_failures(updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_target_created ON audit_events(target_type, target_id, created_at DESC);

PRAGMA optimize;
