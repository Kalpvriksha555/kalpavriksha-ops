# Kalpavriksha 1.9.24 Upload/Preview Deployment Failure-Proofing Audit

Date: 2 August 2026

## Objective

Make the latest-changes upload/preview deployment deterministic, idempotent and recoverable without invoking the complete release matrix, touching PostgreSQL, running migrations or reinstalling backend dependencies.

## Failure risks found and closed

### Partial cutover rollback gap

The earlier script set its switched flag only after both backend files and the frontend had already been moved. A failure between those operations could leave a mixed runtime without entering the restore branch.

The new script sets `CUTOVER_STARTED=1` before the first active file replacement. Any failure from that point restores both backend files and the complete previous frontend, stops a partially started target process, restarts the previous PM2 process and requires readiness.

### Registry-only frontend build

The earlier build depended entirely on a successful live npm registry request.

The new deployment uses a package-lock-keyed, root-owned frontend dependency cache. It first attempts a completely offline clean installation from npm's already-warmed cache, then retries through `--prefer-offline` with bounded fetch retries. A validated reusable dependency cache is retained by exact lock hash. No live file is changed when dependency preparation fails.

### Unpinned or incomplete target runtime

The target is now pinned to the exact current `origin/main` commit. Root and backend versions are verified. All unchanged backend runtime JavaScript modules are hash-compared against the live runtime; if another backend runtime module differs, the incremental deployment refuses to omit it. Installed backend dependency versions must exactly satisfy the target package before downtime.

### Wrong PM2 process/path

Before deployment, the script proves PM2 is online and is running:

- `/var/www/kalpavriksha-ops/backend/src/server.js`
- with working directory `/var/www/kalpavriksha-ops/backend`

After restart it proves the same path and directory again, verifies liveness/readiness JSON and requires a new PM2 PID or restart generation.

### Incomplete rollback copy

The two backend files and complete frontend distribution are copied and hash-verified before PM2 is stopped. The rollback directory remains available after deployment.

### Concurrent or repeated deployment

A system lock prevents two upload/preview deployments from running together. A rerun builds and hashes the pinned target; when all three live runtime hashes already match, it exits successfully without stopping PM2. `KALPA_PREFLIGHT_ONLY=1` performs the complete preflight/build without cutover.

### Build accepted without asset validation

The compiled `index.html` and every local referenced asset are checked for existence and non-empty content. Development endpoints are rejected. Backend source, target copies and final live files are SHA-256 verified before restart.

### Production-data exposure during verifier runs

Production database and private-storage environment variables are explicitly unset inside the isolated verifier subshell. Phase 4, Phase 6, Phase 9 and contract checks run before downtime and cannot inherit the production database connection from the deployment shell.

### Non-atomic evidence record

The deployment evidence record is written to a temporary JSON file, parsed for validity and atomically renamed only after the target backend is READY and PM2 path checks pass. It stores the pinned commit and exact hashes of both backend files and the complete frontend tree.

## Cutover boundary

Before PM2 is stopped, the script completes:

1. tool, path, environment, health and disk checks;
2. deployment lock acquisition;
3. Git fetch with retry and exact commit pinning;
4. source/runtime closure checks;
5. backend dependency verification;
6. targeted tests and Phase 4/6/9/contract verification;
7. offline-first frontend dependency preparation;
8. production frontend build and asset validation;
9. staged runtime hashing;
10. complete rollback-copy creation and verification.

Only then does it stop PM2 and replace:

- `backend/src/server.js`
- `backend/src/services/fileStorageService.js`
- `frontend/dist`

No PostgreSQL operational row, migration, database-integrity metadata or backend dependency is changed.
