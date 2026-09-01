import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/0002_security_hardening.sql', import.meta.url));

function sqlite(database, sql) {
  return execFileSync('sqlite3', ['-batch', '-noheader', database], { input: sql }).toString().trim();
}

test('staff authentication uses only verified Cloudflare Access JWTs', () => {
  assert.match(worker, /verifyAccessToken\(request\.headers\.get\('Cf-Access-Jwt-Assertion'\),env\)/);
  assert.match(worker, /header\.alg!=='RS256'/);
  assert.doesNotMatch(worker, /ADMIN_API_KEY|createStaffSession|staffSessionCookie|STAFF_SESSION_COOKIE|STAFF_SESSION_SECONDS|handleAdmin\(/);
});

test('documents are served as downloads and use pending state', () => {
  assert.match(worker, /object_status.*'pending'/);
  assert.match(worker, /Content-Disposition.*attachment/);
  assert.match(worker, /Only validated PDF files may be uploaded/);
});

test('initial schema has staff roles and document referential integrity', () => {
  assert.match(schema, /role TEXT NOT NULL CHECK\(role IN \('manager','operator','viewer'\)\)/);
  assert.match(schema, /linked_request_id TEXT REFERENCES document_requests/);
  assert.match(schema, /user_id TEXT NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(schema, /CREATE TABLE staff_sessions/);
});

test('legacy migration preserves production data and enforces referential integrity', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sg-migration-'));
  const legacy = join(directory, 'legacy.sql');
  const database = join(directory, 'database.sqlite');

  writeFileSync(legacy, `
PRAGMA foreign_keys=OFF;
CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,password_hash TEXT,password_salt TEXT,password_iterations INTEGER,status TEXT,created_at TEXT,activated_at TEXT);
CREATE TABLE staff_users(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,password_hash TEXT,password_salt TEXT,password_iterations INTEGER,status TEXT,created_at TEXT);
CREATE TABLE invitations(id TEXT PRIMARY KEY,email TEXT,client_name TEXT,token_hash TEXT UNIQUE,expires_at TEXT,used_at TEXT,created_at TEXT);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at TEXT,created_at TEXT);
CREATE TABLE staff_sessions(token_hash TEXT PRIMARY KEY,staff_user_id TEXT,expires_at TEXT,created_at TEXT);
CREATE TABLE client_profiles(user_id TEXT PRIMARY KEY,phone TEXT,nationality TEXT,country_of_residence TEXT,tax_residence TEXT,client_reference TEXT,address TEXT,onboarding_status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE document_requests(id TEXT PRIMARY KEY,user_id TEXT,request_type TEXT,notes TEXT,status TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,category TEXT,r2_key TEXT,mime_type TEXT,file_size INTEGER,created_at TEXT,uploaded_by_staff_id TEXT,linked_request_id TEXT);

INSERT INTO users VALUES
 ('u-active','client@example.com','Active Client','hash-a','salt-a',100000,'active','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z'),
 ('u-inactive','inactive@example.com','Inactive Client','hash-b','salt-b',100000,'inactive','2026-01-03T00:00:00Z',NULL);
INSERT INTO staff_users VALUES
 ('s-legal','legal@sovereigntyglobal.org','Legal','legacy-hash','legacy-salt',100000,'active','2026-01-01T00:00:00Z'),
 ('s-ops','ops@sovereigntyglobal.org','Ops','legacy-hash','legacy-salt',100000,'active','2026-01-02T00:00:00Z');
INSERT INTO invitations VALUES ('inv-1','future@example.com','Future Client','invite-hash','2027-01-01T00:00:00Z',NULL,'2026-01-01T00:00:00Z');
INSERT INTO sessions VALUES ('session-hash','u-active','2027-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO staff_sessions VALUES ('staff-session','s-legal','2027-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO client_profiles VALUES ('u-active','+3531','Irish','Ireland','Ireland','REF-1','Dublin','active','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z');
INSERT INTO document_requests VALUES ('req-1','u-active','Tax document','Please provide','in_progress','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z');
INSERT INTO documents VALUES
 ('doc-linked','u-active','Tax Pack','Tax','clients/u-active/doc-linked.pdf','application/pdf',1234,'2026-01-03T00:00:00Z','s-legal','req-1'),
 ('doc-null','u-active','Legacy Scan','General','clients/u-active/doc-null.pdf',NULL,NULL,'2026-01-04T00:00:00Z','s-ops',NULL);
`);

  execFileSync('sqlite3', [database], { input: await readFile(legacy) });
  execFileSync('sqlite3', [database], { input: migration });

  assert.equal(sqlite(database, 'SELECT COUNT(*) FROM users;'), '2');
  assert.equal(sqlite(database, 'SELECT COUNT(*) FROM staff_users;'), '2');
  assert.equal(sqlite(database, 'SELECT COUNT(*) FROM documents;'), '2');
  assert.equal(sqlite(database, "SELECT role FROM staff_users WHERE email='legal@sovereigntyglobal.org';"), 'manager');
  assert.equal(sqlite(database, "SELECT role FROM staff_users WHERE email='ops@sovereigntyglobal.org';"), 'operator');
  assert.equal(sqlite(database, "SELECT r2_key FROM documents WHERE id='doc-linked';"), 'clients/u-active/doc-linked.pdf');
  assert.equal(sqlite(database, "SELECT linked_request_id FROM documents WHERE id='doc-linked';"), 'req-1');
  assert.equal(sqlite(database, "SELECT object_status FROM documents WHERE id='doc-linked';"), 'available');
  assert.equal(sqlite(database, "SELECT mime_type || '|' || file_size || '|' || object_status FROM documents WHERE id='doc-null';"), 'application/pdf|0|available');
  assert.equal(sqlite(database, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='staff_sessions';"), '0');
  assert.equal(sqlite(database, 'PRAGMA foreign_key_check;'), '');

  const staffSchema = sqlite(database, "SELECT sql FROM sqlite_master WHERE type='table' AND name='staff_users';");
  assert.match(staffSchema, /role TEXT NOT NULL/);
  assert.doesNotMatch(staffSchema, /password_hash|password_salt|password_iterations/);
});
