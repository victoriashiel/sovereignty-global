# Sovereignty Global portal deployment

## Database migrations

Apply `schema.sql` only when creating a new D1 database. It is the canonical schema and includes foreign keys, deletion semantics, role support, audit events, and document object states.

Existing legacy databases must first apply `migrations/0002_security_hardening.sql`. Schedule a maintenance window to rebuild legacy tables from `schema.sql` so that foreign-key and check constraints are enforced; SQLite cannot add those constraints in place.

```bash
npx wrangler d1 execute sovereignty-global-clients --remote --file=schema.sql
# Existing legacy database only:
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

## Documents and client access

The R2 bucket must remain private. The Worker accepts only validated PDF uploads up to 25 MiB and always downloads them as attachments. Metadata starts as `pending` and is visible to clients only after R2 writes succeed. Reconcile `pending`/`failed` records and R2 objects after operational failures.

Client accounts use 150,000-iteration PBKDF2-SHA-256 hashes and Secure, HttpOnly, SameSite=Strict cookies. Staff authentication is delegated to Cloudflare Access rather than a shared portal password. The canonical client destination is `/portal-overview.html`.
