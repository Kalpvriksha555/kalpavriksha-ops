# Backup, Restore and Rollback Runbook

## Safety rule

Never restore an old full database over the live database merely to recover a few finance fields. Restore the old backup into an isolated drill database, compare records, and copy only verified missing fields.

## Production configuration

```bash
KALPA_BACKUP_ROOT=/var/backups/kalpavriksha
KALPA_FILE_STORAGE_ROOT=/var/lib/kalpavriksha/private-files
FILE_STORAGE_PERSISTENT=true
BACKUP_REQUIRED=true
BACKUP_STORAGE_PERSISTENT=true
BACKUP_MAX_AGE_HOURS=26
BACKUP_RETENTION_DAYS=30
BACKUP_RETENTION_COUNT=30
```

The backup root and private-file root should be outside the application release directory and included in infrastructure snapshots/off-server replication.

## Create an atomic verified backup

From the project root:

```bash
npm run backup:create
```

The command creates a PostgreSQL custom dump, private-file archive and SHA-256 manifest. Partial files use a `.partial` suffix and are not treated as backups.

Verify the newest backup again:

```bash
npm run backup:verify
npm run backup:status
```

A healthy manifest must report `VERIFIED` and be younger than `BACKUP_MAX_AGE_HOURS`.

## Restore drill

Create a separate empty PostgreSQL database whose name clearly includes `restore_drill`, then configure:

```bash
RESTORE_DRILL_DATABASE_URL='postgresql://.../kalpavriksha_restore_drill'
KALPA_RESTORE_DRILL_ROOT=/var/tmp/kalpavriksha-restore-drill
```

Run:

```bash
npm run restore:drill
```

The drill validates migrations, relational metadata, case counts and private-file archive extraction. It refuses to run when the drill URL matches `DATABASE_URL`.

## Daily systemd schedule

Install the provided unit examples from `docs/deployment/systemd/`, adjust `WorkingDirectory` and environment-file paths, then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kalpavriksha-backup.timer
sudo systemctl list-timers kalpavriksha-backup.timer
```

## Release backup sequence

1. Stop deployment changes, but keep the live service running.
2. Run `npm run backup:create` against the current live database and file storage.
3. Run `npm run backup:verify`.
4. Copy the verified backup set to separate storage.
5. Save the current backend release and frontend build identifiers.
6. Only then run migrations or deploy a new release.

## Rollback

Application rollback and data rollback are separate decisions.

1. Stop the backend from accepting traffic.
2. Preserve a new backup of the failed state before altering it.
3. Restore the previous application release.
4. Restore data only when verified corruption requires it.
5. Start the backend and check `/api/health/live` and `/api/health/ready`.
6. Confirm database version, backup freshness, file storage and finance totals.
