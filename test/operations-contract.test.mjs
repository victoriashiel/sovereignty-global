import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('wrangler config includes operations queue and onboarding workflow', async () => {
  const config = await text('wrangler.jsonc');
  assert.match(config, /"binding": "OPERATIONS_QUEUE"/);
  assert.match(config, /"queue": "sovereignty-global-operations"/);
  assert.match(config, /"dead_letter_queue": "sovereignty-global-operations-dlq"/);
  assert.match(config, /"binding": "ONBOARDING_WORKFLOW"/);
  assert.match(config, /"class_name": "ClientOnboardingWorkflow"/);
});

test('worker entrypoint supports queue consumption and workflow triggering', async () => {
  const source = await text('src/index.js');
  assert.match(source, /async queue\(batch, env\)/);
  assert.match(source, /ONBOARDING_WORKFLOW\.create/);
  assert.match(source, /OPERATIONS_QUEUE\.send/);
  assert.match(source, /notification_outbox/);
  assert.match(source, /activity_events/);
});

test('onboarding workflow is durable and reviewed twice', async () => {
  const source = await text('src/onboarding-workflow.js');
  assert.match(source, /extends WorkflowEntrypoint/);
  assert.match(source, /step\.sleep\('wait for first review', '7 days'\)/);
  assert.match(source, /step\.sleep\('wait for second review', '7 days'\)/);
  assert.match(source, /onboarding\.review_due/);
});

test('operations migration defines idempotent event storage', async () => {
  const migration = await text('migrations/0004_operations_and_onboarding.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS activity_events/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notification_outbox/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS onboarding_workflows/);
  assert.match(migration, /event_id TEXT NOT NULL UNIQUE/);
});
