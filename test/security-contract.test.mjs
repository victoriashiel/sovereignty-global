import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
