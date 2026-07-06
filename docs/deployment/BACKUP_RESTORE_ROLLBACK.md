# Backup, Restore and Rollback Guide

## Backup Before Release
- Export PostgreSQL database.
- Copy upload storage directory or storage bucket.
- Save current frontend build.
- Save current backend release folder.
- Save current `.env` files securely.

## PostgreSQL Backup Example

```bash
pg_dump "$DATABASE_URL" > kalpavriksha_backup_before_v1.sql
```

## Restore Example

```bash
psql "$DATABASE_URL" < kalpavriksha_backup_before_v1.sql
```

## Rollback Steps
1. Stop backend service.
2. Restore previous backend release folder.
3. Restore previous frontend build.
4. Restore database backup if schema/data corruption occurred.
5. Restart backend.
6. Verify `/api/health` and `/api/state`.

## Rollback Rule
Rollback only to a release that is already confirmed stable in production.
