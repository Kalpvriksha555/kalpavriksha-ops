# Kalpavriksha 1.9.27 — Permanent Source-Parity Cutover Closure

## Production failure closed

The 1.9.26 deployment successfully passed dependency installation, the full verification suite, clean-install verification, a new verified PostgreSQL + private-file backup, migrations, strict relational integrity, release certification, the release gate in the isolated release tree, and staged backend liveness/readiness.

The cutover then failed only after synchronizing the certified release into the permanent live directory. `rsync --delete` reported that it could not remove an old nested `backend/backend/src` tree. Because that stale source tree remained inside `/var/www/kalpavriksha-ops`, the permanent release gate correctly rejected the live directory with `Certificate source hash does not match the deployed source.` The runtime rollback then restored the previous backend.

This was a permanent-path source-parity defect, not a database-integrity or backup defect.

## Permanent corrections

- `scripts/source-parity-clean.mjs` now runs immediately after the permanent rsync and before production dependency installation or the permanent release gate.
- The cleaner removes accidental nested duplicate project roots (`backend/backend`, `frontend/frontend`, `scripts/scripts`, `docs/docs`) only when those paths do not exist in the certified release.
- It removes every other obsolete live source file that is visible to the same canonical source-tree hashing function but absent from the certified release.
- It refuses path traversal and never recursively deletes ignored runtime storage merely to make a hash pass.
- Canonical source hashing now explicitly ignores the deployment-preserved runtime roots `backend/data`, `data`, `private-files`, and `backups`, in addition to the already ignored `.git`, dependencies, frontend `dist`, uploads, logs and environment files.
- After cleanup, release and permanent-live source hashes, file counts and per-file SHA-256 values must match exactly. Any missing, extra or changed source file aborts the deployment before the permanent PM2 switch.
- The parity report is preserved in the deployment work directory as `permanent-source-parity.json`.
- 1.9.26 deployment entrypoints are disabled in this package so the old permanent-path synchronization path cannot be reused accidentally.

All 1.9.26 deployment concurrency/backup protections and all 1.9.25 relational-write integrity protections are retained.
