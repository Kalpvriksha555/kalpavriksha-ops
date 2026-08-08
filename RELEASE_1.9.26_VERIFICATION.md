# Release 1.9.26 Verification

Release: `1.9.26-deployment-concurrency-backup-closure`  
Backend: `2.9.26-deployment-concurrency-backup-closure`  
Frontend: `2.9.26-deployment-concurrency-backup-closure`

## Baseline identity

The supplied source ZIP was independently hashed before modification:

`fa0b5a28352eebdca51112ef888081c0916c9e768d2ef718a0641701c1ba0cd0`

That exactly matches the certified Kalpavriksha 1.9.25 package used in the production incident investigation. No earlier 1.9.24 source was used for this release.

## Scope

1.9.26 carries forward the 1.9.25 permanent relational-write integrity implementation and closes the deployment failures observed during the 2026-08-07 production cutover:

- cross-release exclusive deployment `flock`;
- safe early-failure handling before any PM2/live mutation;
- backup timer coordination and in-flight backup waiting;
- checksum-converged rsync private-file snapshot before tar;
- rejection of backup roots nested inside private-file storage;
- cleanup of temporary backup snapshots;
- backup readiness based on the latest fresh VERIFIED recovery point while retaining a warning for a newer failed attempt;
- release certification bound to the latest verified backup;
- SSH-independent `Type=simple` systemd launcher;
- 1.9.25 deployment entrypoint disabled in the 1.9.26 package to prevent accidental reuse.

## Verification performed on the changed package

- Node syntax: **137 JS/MJS/CJS files passed**.
- Bash syntax: **5 shell scripts passed**.
- Frontend regression suite: **72/72 passed**.
- Focused backend/static regression suite: **15/15 passed**.
- New deployment-runtime closure tests: **5/5 passed** (included in the 15 focused tests).
- Frontend/backend contract verification: **72 checks / 83 backend routes passed**.
- Security package audit: **passed**.
- Project doctor: **passed with zero warnings**.
- Regression guard: **passed**.
- Production regression audit: **passed**.
- Dynamic files-only backup simulation: **VERIFIED** with `rsync-converged-snapshot` and readable tar archive.
- Dynamic changing-source simulation: the source was deliberately mutated between the first snapshot sync and verification; drift was detected, the second sync converged, and the resulting archive contained the final file content: **passed**.
- Backup-health continuity simulation: newer FAILED manifest + recent VERIFIED manifest remained `HEALTHY` with `LATEST_BACKUP_ATTEMPT_FAILED`: **passed**.
- Deployment-lock simulation: a held production lock caused a second deploy invocation to exit before live-path validation or mutation: **passed**.
- Source delta review against the exact 1.9.25 ZIP: **6 files added, 17 files changed, 0 files removed** before manifest regeneration; all changes are release/version, deployment, backup/reliability, documentation or focused-verification scope.

## Dependency-install note

The artifact environment's internal npm mirror returned HTTP 404 for packages that are present in the supplied lockfiles (`zod-validation-error@4.0.2` and `yargs-parser@18.1.3`), so a fresh local `npm ci` / full dependency-backed backend matrix could not be rerun in this sandbox. This is an environment mirror limitation, not a package-lock resolution change.

The exact supplied 1.9.25 baseline had already passed the full production verification on the VPS before the backup gate (including 140/140 backend tests, frontend build, finance/auth/authorization/database/file/reliability/release checks and 72 contract checks). The 1.9.26 production deployer still runs isolated `npm ci`, the complete `npm run verify`, clean-install verification and build **before it stops the live backend**. With 1.9.26's `LIVE_MUTATED` guard, any failure in those pre-downtime gates leaves the current PM2 runtime untouched.

## Production safety invariant

The release does not restore, rewrite or rebaseline business collections. It retains 1.9.25 PostgreSQL physical read-back hashing, selected-row verification, metadata compare-and-swap and presence-write isolation. The deployer requires a verified full backup and strict relational integrity before staging/cutover, and it restores the captured prior runtime on any failure after live mutation begins.
