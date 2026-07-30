# Phase 8 — Automated Testing and Release Certification

Phase 8 prevents an untested, stale, unbacked, or incorrectly configured build from being deployed. It also provides a selective finance-recovery mechanism that cannot replace current tasks, archive records, documents, assignments, or timelines.

## Release workflow

### 1. Clean-install verification

Run from a clean local/VPS checkout:

```bash
npm run release:clean-install
```

The command copies the source into an isolated temporary directory, performs fresh root/backend/frontend `npm ci` installations, builds the frontend, checks backend syntax, compares source hashes, and writes `.release/clean-install-report.json`.

### 2. Create a verified backup

```bash
npm run backup:create
npm run backup:verify
```

Copy the verified backup outside the VPS before database migration or finance recovery.

### 3. Create the release certificate

Production values must be loaded into the environment. Then run:

```bash
npm run release:certify
```

Certification runs every security, finance, authentication, authorisation, database, file, reliability, frontend-unit and Phase 8 regression check. It also runs the build and PostgreSQL integrity check. The generated certificate contains a source-tree hash, versions, test results, clean-install evidence, backup evidence and expiry time. When PostgreSQL is configured, the certificate is recorded in `release_certifications`.

### 4. Deployment gate

```bash
npm run release:gate
```

Deployment is blocked when the certificate is missing, expired, edited, for another source tree/version, lacks clean-install evidence, lacks a current verified backup, or the production environment is unsafe.

Production readiness also checks the certificate through:

```text
GET /api/system/release-certification
GET /api/health/ready
```

## Selective finance recovery

Never restore an old database over the live database.

1. Restore the July 28/29 backup into an isolated temporary PostgreSQL database.
2. Preserve a new verified backup of the current live database.
3. Generate a dry-run recovery plan:

```bash
npm run finance-recovery:plan -- \
  --source-database-url "postgresql://...temporary_restore..." \
  --output "/root/finance-recovery-plan.json" \
  --actor "Amit Kushwaha"
```

A browser JSON export may be used with `--source-json`, but only newer finance snapshots are eligible.

4. Review every `RECOVER` item in the plan. `REVIEW` and `SKIP_*` items are never applied automatically.
5. Apply with the exact plan-specific confirmation:

```bash
npm run finance-recovery:apply -- \
  --plan "/root/finance-recovery-plan.json" \
  --confirmation "APPLY FINANCE RECOVERY <plan-id>" \
  --actor "Amit Kushwaha"
```

Application is one PostgreSQL transaction. It verifies the database fingerprint, live state version, plan hash, source hashes and current target-finance hashes. It updates only protected finance fields, creates finance-history entries, creates a state revision, records `finance_recovery_runs`, and produces a private receipt.

## Migration 008.001

Adds:

- `release_certifications`
- `finance_recovery_runs`

Both provide immutable operational evidence for release and recovery actions.
