# Kalpvriksha Designs Ops — Phase 9 Hardened Release Candidate

This source-only package contains all nine completed hardening phases:

1. Emergency package and secret cleanup
2. Finance durability and anti-rollback protection
3. Secure backend authentication and sessions
4. Server-enforced authorisation and API protection
5. Relational database and migration integrity
6. Private file storage, validation and reconciliation
7. Reliability, verified backups, monitoring and recovery
8. Automated tests, release certification and selective finance recovery
9. Frontend architecture, performance, accessibility and grouped archive UX

It excludes credentials, production records, client documents, dependencies, logs and generated frontend bundles.

## Local development

```powershell
npm ci
npm run dev
```

The frontend runs at `http://localhost:5173` and uses `http://localhost:8080`. Copy `backend/.env.example` to `backend/.env` for an isolated local sandbox or PostgreSQL configuration. Never place production secrets, databases or client documents in the repository or distributable ZIP.

A new empty sandbox needs the one-time bootstrap Admin documented in `backend/.env.example`. Existing live users are migrated from legacy credentials and must replace weak or temporary passwords at first login.

## Production requirements

- `NODE_ENV=production`
- Valid PostgreSQL `DATABASE_URL`
- Explicit `CORS_ORIGIN`
- Explicit frontend `VITE_API_URL` during build
- Persistent private storage through `KALPA_FILE_STORAGE_ROOT`
- `FILE_STORAGE_PERSISTENT=true` only after the mounted directory is verified
- Optional read-only legacy source through `KALPA_LEGACY_UPLOAD_DIR` during reconciliation
- Rotated PostgreSQL, email and LiveKit credentials
- HTTPS through Nginx or another trusted reverse proxy
- Bootstrap Admin variables removed after first successful setup

Production stops when PostgreSQL, trusted origins or persistent private file storage are missing. Finance saves wait for durable persistence. Identity and permissions come only from secure server sessions. Operational state is stored in relational PostgreSQL tables. New files are signature-validated, checksummed and stored privately rather than served from an upload directory.

## Verification

```powershell
npm ci
npm run verify:finance
npm run verify:auth
npm run verify:authorization
npm run verify:database
npm run verify:files
npm run verify:reliability
npm run test:frontend
npm run verify:release
npm run verify:frontend-ux
npm run verify
```

Read before deployment:

- `PHASE_1_SECURITY_CLEANUP.md`
- `PHASE_2_FINANCE_DURABILITY.md`
- `PHASE_3_SECURE_AUTHENTICATION.md`
- `PHASE_4_AUTHORIZATION_API_PROTECTION.md`
- `PHASE_5_DATABASE_INTEGRITY.md`
- `PHASE_6_FILE_STORAGE_HARDENING.md`
- `PHASE_6_VERIFICATION_RESULTS.md`
- `PHASE_7_RELIABILITY_BACKUP_RECOVERY.md`
- `PHASE_7_VERIFICATION_RESULTS.md`
- `PHASE_8_RELEASE_CERTIFICATION.md`
- `PHASE_8_VERIFICATION_RESULTS.md`
- `PHASE_9_FRONTEND_UX_COMPLETION.md`
- `PHASE_9_VERIFICATION_RESULTS.md`
- `HARDENING_ROADMAP.md`
- `RELEASE_CHECKLIST.md`

All development phases are complete. Do not deploy over the live system until the current PostgreSQL database and private files are backed up, the missing finance values are recovered selectively from an isolated verified source, and this exact source tree passes the release-certificate gate on the deployment machine.


## Reliability commands

```bash
npm run backup:create
npm run backup:verify
npm run backup:status
npm run restore:drill
```

Use `/api/health/live` for process liveness and `/api/health/ready` for traffic readiness.


## Certified release commands

```bash
npm run release:clean-install
npm run release:certify
npm run release:gate
```

Finance recovery remains a separate operator-controlled process:

```bash
npm run finance-recovery:plan -- --source-database-url "<isolated-old-backup-db>" --output "/root/finance-recovery-plan.json"
npm run finance-recovery:apply -- --plan "/root/finance-recovery-plan.json" --confirmation "APPLY FINANCE RECOVERY <plan-id>"
```
