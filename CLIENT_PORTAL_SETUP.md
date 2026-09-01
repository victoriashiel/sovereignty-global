# Sovereignty Global portal deployment

## Database migrations

Apply `schema.sql` only when creating a new D1 database. It is the canonical schema and includes foreign keys, deletion semantics, role support, audit events, and document object states.

Existing production databases that have the legacy Worker-created `documents.linked_request_id` must apply `migrations/0002_security_hardening.sql` exactly once. It is an in-place transactional rebuild: it preserves client IDs, invitation/session records, document R2 keys, request links and profile data; creates Access-only staff roles; drops obsolete staff password sessions; and runs `foreign_key_check`. Take a D1 backup first and verify that check returns no rows before deploying the Worker.

```bash
npx wrangler d1 execute sovereignty-global-clients --remote --file=schema.sql # new database only
# Existing production database with legacy documents.linked_request_id:
npx wrangler d1 execute sovereignty-global-clients --remote --file=migrations/0002_security_hardening.sql
```

## Required Cloudflare Access policy

Do **not** expose `/staff.html` or `/api/staff/*` publicly. Before deployment, create a Cloudflare Access application covering both paths and require the organisation identity provider with MFA. The Worker accepts staff requests only when Access supplies both `Cf-Access-Authenticated-User-Email` and `Cf-Access-Jwt-Assertion`; configure Access so these headers cannot be supplied by an untrusted origin.

Set the non-secret Worker variables `ACCESS_TEAM_DOMAIN` (for example, `team.cloudflareaccess.com`) and `STAFF_ACCESS_AUD` (the Access application audience). The Worker verifies the Access JWT against the team JWKS, issuer, audience, expiry, and employee email before authorising staff API access.
Restrict or disable the Workers.dev route and any other origin that could bypass the Access application.

Provision each authorised employee as a separate `staff_users` record with a unique email, an `active` status, and the least-privileged role:

- `viewer`: read-only access
- `operator`: client/document/request operations
- `manager`: employee lifecycle and destructive operations

The legacy browser `ADMIN_API_KEY` interface has been removed. Never put a Worker secret in a browser.
Seed the first `manager` during the controlled database migration. Thereafter, managers use `POST /api/staff/team` to provision individual staff records after the identity has been approved in Cloudflare Access. Deactivating a record immediately prevents API access.

## Documents and client access

The R2 bucket must remain private. The Worker accepts only validated PDF uploads up to 25 MiB and always downloads them as attachments. Metadata starts as `pending` and is visible to clients only after R2 writes succeed. Reconcile `pending`/`failed` records and R2 objects after operational failures.

Client accounts use 150,000-iteration PBKDF2-SHA-256 hashes and Secure, HttpOnly, SameSite=Strict cookies. Staff authentication is delegated to Cloudflare Access rather than a shared portal password. The canonical client destination is `/portal-overview.html`.
