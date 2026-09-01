-- Apply once to the production legacy schema after its Worker-added
-- documents.linked_request_id column exists. D1 executes migrations inside an
-- implicit transaction, so this file deliberately does not issue BEGIN/COMMIT.
-- IDs and R2 keys are preserved, obsolete staff password sessions are discarded,
-- and the legacy legal account becomes the first manager. Take a D1 backup first.
PRAGMA defer_foreign_keys = ON;

ALTER TABLE users RENAME TO legacy_users;
ALTER TABLE staff_users RENAME TO legacy_staff_users;
ALTER TABLE invitations RENAME TO legacy_invitations;
ALTER TABLE sessions RENAME TO legacy_sessions;
ALTER TABLE staff_sessions RENAME TO legacy_staff_sessions;
ALTER TABLE client_profiles RENAME TO legacy_client_profiles;
ALTER TABLE documents RENAME TO legacy_documents;
ALTER TABLE document_requests RENAME TO legacy_document_requests;

CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,password_iterations INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),created_at TEXT NOT NULL,activated_at TEXT);
CREATE TABLE staff_users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('manager','operator','viewer')),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),created_at TEXT NOT NULL);
CREATE TABLE invitations (id TEXT PRIMARY KEY,email TEXT NOT NULL,client_name TEXT,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE client_profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,phone TEXT,nationality TEXT,country_of_residence TEXT,tax_residence TEXT,client_reference TEXT,address TEXT,onboarding_status TEXT NOT NULL DEFAULT 'active' CHECK(onboarding_status IN ('active','onboarding','paused')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE document_requests (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_type TEXT NOT NULL,notes TEXT,status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','completed','declined')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE documents (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,category TEXT,r2_key TEXT NOT NULL UNIQUE,mime_type TEXT NOT NULL,file_size INTEGER NOT NULL CHECK(file_size >= 0),created_at TEXT NOT NULL,uploaded_by_staff_id TEXT REFERENCES staff_users(id) ON DELETE SET NULL,linked_request_id TEXT REFERENCES document_requests(id) ON DELETE SET NULL,object_status TEXT NOT NULL DEFAULT 'pending' CHECK(object_status IN ('pending','available','failed')));
CREATE TABLE audit_events (id TEXT PRIMARY KEY,actor_staff_id TEXT REFERENCES staff_users(id) ON DELETE SET NULL,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT,metadata TEXT,created_at TEXT NOT NULL);
CREATE TABLE login_failures (subject_hash TEXT PRIMARY KEY,count INTEGER NOT NULL,window_started_at TEXT NOT NULL,updated_at TEXT NOT NULL);

INSERT INTO users SELECT id,email,name,password_hash,password_salt,password_iterations,status,created_at,activated_at FROM legacy_users;
INSERT INTO staff_users SELECT id,email,COALESCE(name,email),CASE WHEN email='legal@sovereigntyglobal.org' THEN 'manager' ELSE 'operator' END,status,created_at FROM legacy_staff_users;
INSERT INTO invitations SELECT id,email,client_name,token_hash,expires_at,used_at,created_at FROM legacy_invitations;
INSERT INTO sessions SELECT token_hash,user_id,expires_at,created_at FROM legacy_sessions;
INSERT INTO client_profiles SELECT user_id,phone,nationality,country_of_residence,tax_residence,client_reference,address,onboarding_status,created_at,updated_at FROM legacy_client_profiles;
INSERT INTO document_requests SELECT id,user_id,request_type,notes,status,created_at,updated_at FROM legacy_document_requests;
INSERT INTO documents SELECT id,user_id,title,category,r2_key,COALESCE(mime_type,'application/pdf'),COALESCE(file_size,0),created_at,uploaded_by_staff_id,linked_request_id,'available' FROM legacy_documents;

DROP TABLE legacy_staff_sessions;
DROP TABLE legacy_documents;
DROP TABLE legacy_document_requests;
DROP TABLE legacy_client_profiles;
DROP TABLE legacy_sessions;
DROP TABLE legacy_invitations;
DROP TABLE legacy_staff_users;
DROP TABLE legacy_users;
CREATE INDEX idx_documents_user_available ON documents(user_id,object_status,created_at DESC);
CREATE INDEX idx_requests_user_created ON document_requests(user_id,created_at DESC);
CREATE INDEX idx_documents_request ON documents(linked_request_id);
CREATE INDEX idx_audit_events_created ON audit_events(created_at DESC);
PRAGMA defer_foreign_keys = OFF;
PRAGMA foreign_key_check;
