# Phase 3 — Backend Authentication and Secure Sessions

Phase 3 replaces browser-side password comparison with server-verified credentials and revocable sessions.

## Implemented

- Passwords are hashed using Node.js `scrypt` with a random salt and a versioned `scrypt-v1` format.
- Plaintext password fields are removed from operational user records during migration.
- Existing legacy users are migrated once and required to replace their old password at first login.
- Login uses an opaque random session token stored only as a SHA-256 hash on the server.
- The browser receives the session only through a Secure/HTTP-only cookie in production.
- Every unsafe authenticated request requires a per-session CSRF token.
- Sessions expire, can be revoked individually, and are revoked when passwords or account status change.
- Failed logins trigger a configurable account lock.
- Password reset uses a time-limited OTP challenge and revokes all existing sessions.
- Employee creation, role changes, restrictions, archival and password resets use Admin-only backend routes.
- Authentication events are recorded in an append-only audit store/table.
- Operational state is not loaded before session verification.
- Session expiry clears in-memory state and sensitive browser caches.
- API responses never include password hashes or plaintext password fields.

## One-time production migration

Before deployment, back up PostgreSQL. On startup, existing user records with legacy passwords are converted into `auth_credentials`, and credential fields are removed from `app_state`.

If the live database has no usable legacy credentials, configure a one-time bootstrap Admin through server secrets:

```env
BOOTSTRAP_ADMIN_USERNAME=...
BOOTSTRAP_ADMIN_PASSWORD=...
BOOTSTRAP_ADMIN_NAME=...
```

The bootstrap password must be at least 10 characters and include uppercase, lowercase and a number. Remove the bootstrap variables after the first successful startup and verified Admin login.

## Production session settings

```env
SESSION_COOKIE_NAME=kv_session
SESSION_TTL_HOURS=12
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
```

`NODE_ENV=production` makes the session cookie Secure. The backend also trusts one reverse-proxy hop so HTTPS behind Nginx is handled correctly.

## Verification

```powershell
npm ci
npm run verify:auth
npm run verify
```

Do not deploy yet. Phase 4 will add fine-grained route/action authorisation around the authenticated session foundation.
