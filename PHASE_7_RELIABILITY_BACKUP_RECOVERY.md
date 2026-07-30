# Phase 7 — Reliability, Backup, Monitoring and Recovery

Phase 7 adds operational controls that prevent a temporary server failure from looking like a successful save and make database/file recovery measurable rather than assumed.

## Runtime probes

- `GET /api/health/live` reports only whether the process is alive and accepting traffic.
- `GET /api/health/ready` verifies database access, private file storage, disk thresholds, backup freshness and persistence state.
- `GET /api/health` now reflects readiness and returns HTTP 503 when production dependencies are not safe.
- Admin `GET /api/system/reliability` provides detailed diagnostics.

Load balancers and PM2 health checks should use `/api/health/live` for process replacement and `/api/health/ready` before routing user traffic.

## Backup system

`npm run backup:create` creates an atomic backup set containing:

- PostgreSQL custom-format dump
- Private file-storage `tar.gz`
- SHA-256 checksums
- Size metadata
- Content-readability verification
- A versioned manifest

A backup is not considered healthy until its manifest status is `VERIFIED`.

Commands:

```bash
npm run backup:create
npm run backup:verify
npm run backup:status
npm run restore:drill
```

The restore drill refuses to target `DATABASE_URL`. Its separate database name must include `restore`, `drill`, `test` or `staging` unless an explicit unsafe override is supplied.

## Required production variables

```bash
KALPA_BACKUP_ROOT=/var/backups/kalpavriksha
BACKUP_REQUIRED=true
BACKUP_STORAGE_PERSISTENT=true
BACKUP_MAX_AGE_HOURS=26
BACKUP_RETENTION_DAYS=30
BACKUP_RETENTION_COUNT=30
DISK_WARNING_PERCENT=80
DISK_CRITICAL_PERCENT=90
GRACEFUL_SHUTDOWN_TIMEOUT_MS=15000
```

For restore drills only:

```bash
RESTORE_DRILL_DATABASE_URL=postgresql://.../kalpavriksha_restore_drill
KALPA_RESTORE_DRILL_ROOT=/var/tmp/kalpavriksha-restore-drill
```

## Structured logs and failed jobs

HTTP requests, startup, shutdown, persistence failures and unexpected exceptions are emitted as one-line JSON records with request IDs. Passwords, tokens, cookies and secrets are redacted.

PostgreSQL migration `007.001` adds:

- `operational_jobs`
- `operational_events`
- `backup_runs`

Failed state writes are visible to Admins but cannot be automatically replayed because doing so could overwrite newer data. Safe operational jobs can be queued again after review.

## Graceful shutdown

SIGTERM and SIGINT stop new traffic, wait for the current durable persistence queue, close PostgreSQL connections and then exit. A configurable timeout prevents an indefinitely stuck shutdown.

## Deployment rule

Do not mark the backend healthy until the first verified backup exists. Create and verify the pre-migration backup before running Phase 5–7 migrations or the selective finance recovery.
