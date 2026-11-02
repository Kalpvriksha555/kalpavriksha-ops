# Kalpvriksha two-calendar-month uploaded-file retention

## Exactly what expires

Only eligible private uploads linked exclusively to cases which have a reliable dated completion/closure or archive event. The expiry time is **two UTC calendar months after the later of the case's completion/closure, archive, and the file's most recent upload**. Month-end is clamped (e.g., 31 Dec → 28 Feb). Reopened, active, revision, uncertain, shared, legal-hold, dispute, finance, profile, statutory and compliance documents fail closed.

Case rows, case/task IDs, history, payment and finance collections, audit records, annotations and accounting records are retained. Eligible file metadata is marked EXPIRED and URLs cleared; physical content-addressed objects move to recoverable trash only when no active references or leases exist. Trash purges after the configured recovery grace period. Legacy upload/archive directories, historical migration backups and database backup files are **never** removed by this retention service.

## Production activation gate

**Code is disabled by default.** Set FILE_RETENTION_APPLY=true only using the guarded certified-release activation script. FILE_RETENTION_MONTHS=2.

Each destructive retention pass independently verifies **three post-activation, distinct-day, recent complete FULL backups** from the three-backup retention policy. It checks each backup's manifest, local PostgreSQL identity, files/dump completeness, SHA-256 and archive readability. Archive verification executes in a separate child process, not on the API's event loop. If the backup chain is unavailable, malformed, stale, or damaged, it performs **no logical expiration, physical trash move, or trash purge**.

The three backups are all on the same VPS, so this still does not protect against complete host or disk loss; periodic independent restore drills are required for operational assurance. Existing unresolved legacy attachment references are not automatically reconciled or deleted.

## Deployment order — preserve the existing three-full-backup system

1. Merge or deploy a **certified source candidate containing BOTH** the existing three-full-backup patch and this retention update. Never replace only backend/src/server.js in the live tree: changing source without a matching release certificate can break readiness.
2. Run the normal isolated certification/deployment pipeline on the combined, manifest-complete release, not a live Git pull or ad-hoc source overwrite.
3. After the combined release is publicly READY and the nightly full-backup timer is still enabled, run scripts/activate-two-month-attachment-retention-vps.sh as root. It checks the exact current release certificate, verifies the existing lifecycle tests, backs up the original environment, updates only FILE_RETENTION_APPLY and FILE_RETENTION_MONTHS, and restarts PM2 with rollback upon failure.
4. On subsequent daily retention runs, the three-backup gate will automatically hold the operation until three new complete recovery points exist. Do not bypass this gate or edit/delete protected manual backups.
5. Validate log entries automatic_file_retention_dry_run, automatic_file_retention_deferred, or automatic_file_retention_completed and audit records for individual expired files; separately test restore from a selected full snapshot before retiring historical archives.

## Important non-goals

This is not the historical-backup cleanup, not a migration to Supabase, and not a change to the UI, finance synchronization, authentication or database schema. It never operates on protected historical archives. Any rule to automatically delete files in team-wide chats without a closed case and proof of exclusive ownership must be designed separately, not assumed safe.
