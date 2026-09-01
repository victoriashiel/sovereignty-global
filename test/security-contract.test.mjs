import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');

test('staff authentication requires verified Cloudflare Access JWTs', () => {
  assert.match(worker, /verifyAccessToken\(request\.headers\.get\('Cf-Access-Jwt-Assertion'\),env\)/);
  assert.match(worker, /header\.alg!=='RS256'/);
  assert.match(worker, /Staff password authentication has been removed/);
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
});

test('legacy migration rebuilds the Worker-created production schema', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sg-migration-'));
  const legacy = join(directory, 'legacy.sql'), database = join(directory, 'database.sqlite');
  writeFileSync(legacy, `CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,password_hash TEXT,password_salt TEXT,password_iterations INTEGER,status TEXT,created_at TEXT,activated_at TEXT);CREATE TABLE staff_users(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,password_hash TEXT,password_salt TEXT,password_iterations INTEGER,status TEXT,created_at TEXT);CREATE TABLE invitations(id TEXT PRIMARY KEY,email TEXT,client_name TEXT,token_hash TEXT UNIQUE,expires_at TEXT,used_at TEXT,created_at TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at TEXT,created_at TEXT);CREATE TABLE staff_sessions(token_hash TEXT PRIMARY KEY,staff_user_id TEXT,expires_at TEXT,created_at TEXT);CREATE TABLE client_profiles(user_id TEXT PRIMARY KEY,phone TEXT,nationality TEXT,country_of_residence TEXT,tax_residence TEXT,client_reference TEXT,address TEXT,onboarding_status TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE document_requests(id TEXT PRIMARY KEY,user_id TEXT,request_type TEXT,notes TEXT,status TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE documents(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,category TEXT,r2_key TEXT,mime_type TEXT,file_size INTEGER,created_at TEXT,uploaded_by_staff_id TEXT,linked_request_id TEXT);`);
  execFileSync('sqlite3', [database], { input: await readFile(legacy) });
  execFileSync('sqlite3', [database], { input: await readFile(new URL('../migrations/0002_security_hardening.sql', import.meta.url)) });
  assert.match(execFileSync('sqlite3', [database, '.schema staff_users']).toString(), /role TEXT NOT NULL/);
});
