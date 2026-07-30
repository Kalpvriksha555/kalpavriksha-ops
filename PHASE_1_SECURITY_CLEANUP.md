# Phase 1 — Emergency Security Cleanup

## Completed in this package

- Removed populated frontend and backend `.env` files.
- Removed the bundled operational database, staff records, passwords, chats, attendance, payments and audit data.
- Removed 43 private uploaded documents from the source package.
- Removed backend `node_modules`, generated frontend bundles and runtime logs.
- Removed hard-coded staff seed accounts and plaintext default passwords from backend source.
- Changed localhost to use the local API instead of silently connecting to production.
- Made production require an explicit frontend API URL and fail the build when it is missing.
- Made production require PostgreSQL and stop on database connection failure.
- Limited JSON persistence to an explicitly enabled, non-production local sandbox.
- Pinned package versions and replaced private package-registry URLs with official npm registry URLs.
- Added a security package audit to prevent these files and settings from returning.
- Repaired an unmatched JSX closing element in the unified file viewer that would block a clean frontend compilation.

## Mandatory credential rotation outside this ZIP

The previous archive contained populated credentials. Rotate them before deploying this package:

1. Rotate the PostgreSQL user password/connection string and update the VPS secret.
2. Revoke the exposed Gmail/email app password and create a new one.
3. Rotate the LiveKit API key and secret.
4. Rotate any credential reused in another service.
5. Remove exposed secrets and private files from Git history if they were ever pushed.
6. Restart the backend with the new environment and invalidate old sessions/tokens where applicable.

The new credentials must not be pasted into this project folder or committed to Git.

## Data preservation

This cleanup does **not** delete the live PostgreSQL database. The original ZIP remains the only local copy of its bundled snapshot and documents. Do not copy its `.env`, `db.json`, or upload folder back into this clean source package. Production should use its existing PostgreSQL database and separately managed persistent upload directory.

## Next phase update

Finance durability was moved ahead as Phase 2 because the live system experienced a finance rollback. Backend authentication and server sessions are now Phase 3 in `HARDENING_ROADMAP.md`.
