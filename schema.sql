PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
  password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, password_iterations INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL, activated_at TEXT
);
CREATE TABLE staff_users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager','operator','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), created_at TEXT NOT NULL
);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, client_name TEXT, token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE client_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, phone TEXT, nationality TEXT,
  country_of_residence TEXT, tax_residence TEXT, client_reference TEXT, address TEXT,
  onboarding_status TEXT NOT NULL DEFAULT 'active' CHECK(onboarding_status IN ('active','onboarding','paused')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE document_requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'new'
  CHECK(status IN ('new','in_progress','completed','declined')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, category TEXT, r2_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK(file_size > 0), created_at TEXT NOT NULL,
  uploaded_by_staff_id TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  linked_request_id TEXT REFERENCES document_requests(id) ON DELETE SET NULL,
  object_status TEXT NOT NULL DEFAULT 'pending' CHECK(object_status IN ('pending','available','failed'))
);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, actor_staff_id TEXT REFERENCES staff_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE login_failures (
  subject_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, window_started_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_documents_user_available ON documents(user_id, object_status, created_at DESC);
CREATE INDEX idx_requests_user_created ON document_requests(user_id, created_at DESC);
CREATE INDEX idx_documents_request ON documents(linked_request_id);
CREATE INDEX idx_audit_events_created ON audit_events(created_at DESC);
