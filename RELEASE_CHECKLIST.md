# Kalpvriksha Ops — Release Checklist

## Before every deploy

```powershell
npm ci
npm run security:package-audit
npm run verify
npm run release:clean-install
```

## Production configuration

- Set `NODE_ENV=production`.
- Set the rotated PostgreSQL `DATABASE_URL`.
- Set explicit `CORS_ORIGIN` and `VITE_API_URL` for the trusted frontend.
- Set `KALPA_FILE_STORAGE_ROOT` to a persistent private mount outside the deployment directory.
- Set `FILE_STORAGE_PERSISTENT=true` only after verifying the mount survives deployment/restart.
- Set `KALPA_LEGACY_UPLOAD_DIR` read-only during the first historical file reconciliation.
- Keep `.env`, database snapshots, uploads, logs, `node_modules`, and `dist` out of Git and ZIP files.
- Confirm the backend exits when PostgreSQL is deliberately unavailable.
- Confirm `npm run verify:auth` passes and a one-time bootstrap Admin is configured only when no live credential can be migrated.
- Confirm HTTPS is active before testing production session cookies.
- Confirm `npm run verify:authorization` passes for Admin, Manager and Designer.
- Confirm no `/uploads` URL can bypass record-level file permissions.
- Run `npm run verify:files`; confirm signature mismatch, executable rejection, authenticated access, legacy import and recoverable deletion pass.
- Confirm `/api/system/files/storage-health` reports writable persistent storage.
- Review `/api/system/files/reconciliation` before running the confirmed reconciliation operation.
- If ClamAV is enabled, confirm its definitions are current before setting `FILE_ANTIVIRUS_REQUIRED=true`.
- Confirm finance partial receipts retain amount, date, mode and reference after restart.
- Run `npm run verify:database` and confirm migration checksums, collection ordering, state-version conflicts and revision protections pass.
- Before the first Phase 5 deployment, create a PostgreSQL dump; startup will import the legacy `app_state` row once without deleting it.
- Confirm `/api/db/health` reports `postgresql-relational`, migration version `008.001`, and `integrity.ok: true`.

## Git process

```powershell
git add .
git commit -m "Complete current Kalpvriksha hardening phase"
git push origin main
```

## Phase 7 reliability gate

- [ ] `npm run backup:create` completed successfully before migration/deployment.
- [ ] Backup manifest status is `VERIFIED`.
- [ ] Verified backup copied outside the VPS or into independent storage.
- [ ] `/api/health/live` returns HTTP 200.
- [ ] `/api/health/ready` returns HTTP 200.
- [ ] Admin System Health shows no critical disk alert or unsafe persistence failure.
- [ ] `npm run restore:drill` passed against an isolated drill database.
- [ ] PM2/systemd sends SIGTERM and the backend completes graceful shutdown.


## Phase 8 release gate

- [ ] Current live PostgreSQL and private files have a VERIFIED backup copied outside the VPS.
- [ ] `npm run release:clean-install` passed for this exact source hash.
- [ ] Production environment variables pass `npm run release:certify`.
- [ ] `npm run release:certify` created an unexpired CERTIFIED report.
- [ ] `npm run release:gate` returns `DEPLOYMENT_ALLOWED`.
- [ ] `/api/system/release-certification` reports valid after restart.
- [ ] No full old-database restore is used for finance recovery.
- [ ] Finance recovery is generated as a dry-run plan and applied only after case-by-case review.


## Phase 9 frontend and UX gate

- [ ] `npm run verify:frontend-ux` passed.
- [ ] The archive opens as collapsible location groups on desktop and mobile.
- [ ] Archive search, bank, location and date filters preserve the expected results.
- [ ] No browser `alert`, `confirm` or `prompt` remains in operational workflows.
- [ ] Keyboard focus, modal dismissal and reduced-motion behaviour were checked.
- [ ] Workspace synchronisation refreshes on focus/online return without a ten-second full-state poll.
- [ ] The production frontend bundle contains no Firebase SDK dependency or embedded Firebase credential.
