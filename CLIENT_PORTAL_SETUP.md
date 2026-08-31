# Sovereignty Global client portal setup

The application code is ready for D1 + R2. The account-level Cloudflare resources must exist before the bindings can be enabled.

## 1. Create the D1 database

```bash
npx wrangler d1 create sovereignty-global-clients
```

Copy the `database_id` returned by Cloudflare.

Apply the schema:

```bash
npx wrangler d1 execute sovereignty-global-clients --remote --file=schema.sql
```

## 2. Create the private R2 bucket

```bash
npx wrangler r2 bucket create sovereignty-global-client-files
```

Do not expose this bucket publicly. Client downloads are authorised and streamed through the Worker.

## 3. Enable the bindings in `wrangler.jsonc`

Uncomment the `d1_databases` and `r2_buckets` blocks. Set the D1 `database_id` to the ID from step 1.

Bindings must remain exactly:

- D1: `DB`
- R2: `CLIENT_FILES`

## 4. Add the admin secret

Create a long random secret and store it as a Worker secret:

```bash
npx wrangler secret put ADMIN_API_KEY
```

Do not commit the secret to GitHub or put it in `wrangler.jsonc`.

## 5. Deploy

```bash
npx wrangler deploy
```

## 6. Client journey

1. Open `/admin.html` and enter the `ADMIN_API_KEY` for the current browser session.
2. Create an invitation for the onboarded client's name and email.
3. Copy the generated `/activate.html?invite=...` URL to the client.
4. The invitation is single-use and expires after the chosen period.
5. The client creates a password (minimum 12 characters).
6. They are signed into `/portal.html` with an HttpOnly, Secure, SameSite=Strict session cookie.
7. Upload documents to that client from `/admin.html`; files are stored privately in R2 and metadata in D1.
8. Client document downloads are checked against the authenticated user before the Worker streams the R2 object.
9. Client document requests appear in the admin request queue where their status can be updated.

## Security model

- No public sign-up endpoint exists.
- Invitation tokens are stored in D1 only as SHA-256 hashes.
- Invitation links are single-use and time-limited.
- Passwords are PBKDF2-SHA-256 hashed with per-user random salts and 150,000 iterations.
- Session tokens are random, stored only as SHA-256 hashes in D1, and expire after seven days.
- Browser session cookies are HttpOnly, Secure and SameSite=Strict.
- R2 has no public client URL; files are served only after account-level authorisation.
- Admin operations require the `ADMIN_API_KEY` Worker secret.

For a later phase, the admin API key can be replaced with Cloudflare Access / staff SSO without changing the client data model.
