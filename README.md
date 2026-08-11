> **Current source candidate:** `1.9.30-ssh-independent-certify-deploy-closure`. The guarded end-to-end VPS entrypoint is `bash scripts/launch-certify-and-deploy-1.9.30-vps.sh`. It becomes the production baseline only after the live cutover succeeds.


# Kalpvriksha Designs Ops — Team Transparency & Speed Release

This source-only package contains the completed original hardening programme plus Stability Closure Phases 10–24. The original phases are:

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

Phase 23 closes production-local PostgreSQL certification compatibility. Phase 24 closes the final operator path: stale root deployment instructions are removed, the entire candidate-certification + guarded-deployment pipeline can be launched as an SSH-independent systemd unit, and a full-lifecycle lock prevents two final pipelines from overlapping.

## Local development

```powershell
npm ci
npm run dev
```

The frontend runs at `http://localhost:5173` and uses `http://localhost:8080`. Copy `backend/.env.example` to `backend/.env` for an isolated local sandbox or PostgreSQL configuration. Never place production secrets, databases or client documents in the repository or distributable ZIP.

A new empty sandbox needs the one-time bootstrap Admin documented in `backend/.env.example`. Established approved users keep their existing secure passwords. Only an administrator-created or administrator-reset temporary password requires a one-time replacement. Every browser refresh or reopened page starts signed out and requires a fresh login.

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
- `SESSION_PERFORMANCE_STABILITY_FIX.md`
- `SESSION_PERFORMANCE_STABILITY_VERIFICATION.md`
- `TEAM_TRANSPARENCY_SPEED_FIX.md`
- `TEAM_TRANSPARENCY_SPEED_VERIFICATION.md`
- `PHASE_22_END_TO_END_FAULT_MATRIX_FINAL_STABILITY_SOAK.md`
- `PHASE_22_VERIFICATION_RESULTS.md`
- `PHASE_23_PRODUCTION_LOCAL_POSTGRES_CERTIFICATION_CLOSURE.md`
- `PHASE_23_VERIFICATION_RESULTS.md`
- `PHASE_24_OPERATOR_SAFE_CERTIFY_DEPLOY_CLOSURE.md`
- `PHASE_24_VERIFICATION_RESULTS.md`

Before production deployment, use `scripts/launch-certify-and-deploy-1.9.30-vps.sh` from a clean, non-live checkout of the exact GitHub `main` commit. Phase 21 reuses already-passed candidate/dependency/database phases only when their content-hash receipts still match exactly; Phase 22 additionally requires a complete source manifest including mandatory hidden files and a final combined fault-soak gate; a fresh production backup, current runtime checks, required production database gates, atomic frontend artifact verification, permanent PM2 checks and public health probes remain fail-closed.


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


## VPS deployment

Do not run obsolete July 30 deployment scripts. Push this source tree to `main`, then fetch and execute the deployment script without resetting the live checkout first:

```bash
# Run from a clean candidate checkout outside /var/www/kalpavriksha-ops.
cd /path/to/clean/kalpavriksha-candidate
git fetch origin main
git checkout main
git pull --ff-only origin main
bash scripts/launch-certify-and-deploy-1.9.30-vps.sh
```
