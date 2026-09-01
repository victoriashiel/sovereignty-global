# Cloudflare operations setup

This repository now contains the Worker-side configuration for observability, Queues, D1 operational events, scheduled maintenance, and the client onboarding Workflow.

## 1. Provision the Queue resources

Run once from an authenticated Wrangler session:

```bash
npm run queue:create
npm run queue:dlq:create
```

The Worker is configured as both the producer and consumer for `sovereignty-global-operations`. Failed messages are sent to `sovereignty-global-operations-dlq` after the configured retries.

## 2. Apply D1 migrations

```bash
npm run db:migrate
```

Migration `0004_operations_and_onboarding.sql` creates:

- `activity_events` for non-blocking client and operational events
- `notification_outbox` for security and onboarding alerts
- `onboarding_workflows` for durable onboarding state

## 3. Optional operations webhook

The Queue consumer can deliver high-value alerts to a webhook destination. Store the destination as a Worker secret rather than committing it:

```bash
npx wrangler secret put OPERATIONS_WEBHOOK_URL
```

If this secret is omitted, alerts are still stored in `notification_outbox` and remain available for a future delivery integration.

## 4. Deploy

```bash
npm run check
npm test
npm run deploy
```

The first deployment with the Workflow binding creates `sovereignty-global-client-onboarding` from the exported `ClientOnboardingWorkflow` class.

## 5. Edge rate-limiting rules

These rules must be created at the Cloudflare zone level because WAF rate-limiting policies are not stored in Wrangler configuration.

### Client login

Expression:

```text
(http.request.uri.path eq "/api/auth/login" and http.request.method eq "POST")
```

Recommended starting policy:

- Characteristic: IP address
- Requests: 5
- Period: 15 minutes
- Mitigation timeout: 15 minutes
- Action: Block

The Worker also retains its D1 account, IP, and account-plus-IP rate limiter as a second layer.

### Account activation

Expression:

```text
(http.request.uri.path eq "/api/auth/activate" and http.request.method eq "POST")
```

Recommended starting policy:

- Characteristic: IP address
- Requests: 5
- Period: 15 minutes
- Mitigation timeout: 15 minutes
- Action: Block

### Invitation validation

Expression:

```text
(http.request.uri.path eq "/api/auth/invite" and http.request.method eq "GET")
```

Recommended starting policy:

- Characteristic: IP address
- Requests: 30
- Period: 1 minute
- Mitigation timeout: 10 minutes
- Action: Block

### General API abuse guard

Expression:

```text
starts_with(http.request.uri.path, "/api/")
```

Use a higher threshold than the authentication rules. A reasonable starting point is 120 requests per minute per IP. Review actual portal usage before tightening this rule.

## 6. Cloudflare Notifications

Configure these in the Cloudflare dashboard under Notifications. The available destinations depend on the Cloudflare plan.

Recommended policies:

1. HTTP or Advanced Error Rate alert for elevated 5xx responses on the Sovereignty Global zone.
2. Security Events alert where the current plan supports it, especially for Rate Limiting and WAF spikes.
3. Workers build failure notifications if Cloudflare Builds is used for deployment.
4. Billing budget alert for unexpected usage growth.
5. Cloudflare incident notifications for Workers, D1, R2, Queues, and Access.

For a low-traffic portal, avoid overly sensitive percentage-based error alerts because one isolated error can produce a misleading spike.

## 7. Operational events now recorded

The Worker queues these events without blocking the client response:

- `client.activated`
- `auth.login.succeeded`
- `auth.login.failed`
- `client.request.created`
- `client.document.downloaded`
- `security.rate_limited`
- `security.server_error`
- `onboarding.started`
- `onboarding.review_due`
- onboarding completion or pause events

Events use UUIDs and D1 `INSERT OR IGNORE` semantics so Queue retries do not create duplicate records.

## 8. Onboarding workflow behaviour

After a successful account activation, the Worker starts one durable Workflow instance for that client.

The Workflow:

1. Marks the client profile as `onboarding`, unless staff have paused it.
2. Records the Workflow state in D1.
3. Waits seven days.
4. Checks the client onboarding status, available documents, and open requests.
5. Creates an operations reminder if the client still remains in onboarding.
6. Waits a further seven days and checks again.
7. Creates a higher-priority reminder when the client remains in onboarding after the second review.
8. Ends early when staff mark the client active or paused.

No automated client email is sent by this Workflow. Client-facing communications should be added only when the preferred email provider and message templates are defined.

## 9. Verification

Useful commands:

```bash
npm run queue:list
npm run workflow:list
npm run logs
```

After deployment, activate a test client and confirm that:

- the request returns an `X-Request-ID`
- `client.activated` appears in Workers Logs
- the event is written to `activity_events`
- an onboarding Workflow instance appears in Cloudflare
- the matching row appears in `onboarding_workflows`
