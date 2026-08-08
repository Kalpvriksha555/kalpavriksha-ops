# Kalpavriksha 1.9.26 — Deployment Concurrency & Backup Closure

This release supersedes 1.9.25 for production deployment. It keeps the 1.9.25 permanent relational-write integrity hardening unchanged and closes the deployment failures observed on 2026-08-07.

## Production failures closed

1. Two deployment commands could run at the same time because the 1.9.25 deploy script had no exclusive deployment lock. Concurrent runs could interfere with PM2, backup gates and readiness checks.
2. Full backup archived the live private-file directory directly with GNU tar. If the directory changed while tar was traversing it, tar returned `file changed as we read it`, the mandatory backup gate failed and deployment rolled back.
3. Automatic backup timers were not coordinated with deployment, so scheduled backup work could collide with the deployment's exact pre/post backup gates.
4. A failed newest backup manifest made backup readiness false even when a recent verified backup still existed. A failed attempt must remain visible as a warning, but must not hide the latest valid recovery point.
5. Manual SSH launch was too easy to duplicate and could be interrupted/confused by a terminal disconnect.

## Permanent fixes

- `scripts/deploy-1.9.26-vps.sh` acquires one cross-release `flock` at `/run/lock/kalpavriksha-production-deploy.lock` before any live mutation. A second deployment exits without touching PM2, source, backups or database state.
- Early deployment failures no longer invoke destructive rollback before an immutable rollback runtime has actually been captured.
- The deployer pauses only the full/database backup timers before the exact production backup gate, waits for any already-running backup lock to clear, and restores the timers on both success and rollback.
- `backend/scripts/backup-create.mjs` no longer runs tar against mutable live private storage. It creates a separate rsync snapshot, converges with checksum comparison, verifies a zero-drift dry run, and archives that stable snapshot. The temporary snapshot is always removed.
- Backup root is rejected if it is placed inside private-file storage, preventing recursive/self-changing backups.
- Backup health uses the latest fresh VERIFIED recovery point. A later failed attempt is exposed as `LATEST_BACKUP_ATTEMPT_FAILED` without falsely erasing the valid recovery point.
- Release certification records the latest verified backup rather than a newer failed attempt.
- `scripts/launch-deploy-1.9.26-vps.sh` starts deployment as a `Type=simple` transient systemd service, independent of the SSH connection, and records the unit name for later log retrieval.

## Data safety

The release does not restore, rewrite or rebaseline business collections. Existing 1.9.25 PostgreSQL physical-readback hashing, selected-row verification, metadata compare-and-swap, presence-write isolation and relational integrity protections remain intact.

A pre-deployment full backup remains mandatory. Deployment aborts and restores the captured runtime if any mandatory backup, integrity, certification, staging, permanent cutover, readiness or final integrity gate fails.
