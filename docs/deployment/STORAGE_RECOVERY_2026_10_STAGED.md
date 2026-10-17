# Kalpvriksha Storage & Recovery: October 2026 staging notes

**The code on this branch is not deployed. Production backups and customer files must stay untouched.**

## Preservation requirements
- Protect the latest live PostgreSQL records: attendance, tasks, operation histories,
  September/October reports, payment and bank ledger data, and linked file references.
- Protect the October 16 2026 independent manual DB dump and complete files
  snapshot under /var/backups/kalpavriksha-protected-manual permanently.
- Never restore stale database state over production.
- Live backend health has been recovered; do not restart PM2 or reboot until
  its failed systemd service is inspected and repaired.
- Existing production backup timers are disabled due to unsafe pruning.

## Staged safety changes
1. Backup headroom preflight estimates the space required for the private file
   snapshot, archive, database dump and an operating reserve. It refuses to start
   when disk headroom is insufficient and NEVER prunes earlier recovery points.
2. Historical backup pruning is disabled entirely while off-server verified
   recovery and restore-drill requirements remain unresolved.
3. New file eligibility: TWO CALENDAR MONTHS after a dated case completion or
   archive event, whichever is later, and no earlier than later uploads.
   No deletion for active/reopened cases, missing/ambiguous dates or ownership,
   legal/dispute holds, financial evidence, profile images or chat-shared files.
   Case content, timeline, assignments, payments and history remain.
4. FILE_RETENTION_MONTHS defaults to 2, FILE_RETENTION_APPLY is opt-in
   and unset by default. Daily background runs are dry-runs with no DB writes,
   garbage collection or physical file removal while opt-in is disabled.
5. Runtime certificate readiness requires an intact signed digest, exact
   deployed source fingerprint, matching backend version, passing original
   certification evidence, and required verified backup evidence. AGE-ONLY
   failures become warnings for the identical previously certified release.
   New deployments still require fresh certification before cutover.
6. Hourly disk governor with 80/85/90 percentage warning levels and free-space
   reserve. Optional housekeeping is limited to old regular files inside
   /var/lib/kalpavriksha/governor/work. This governor never deletes customer
   uploads, production DB records, live backup archives or emergency backups.
   Systemd units are staged but not installed.

## Critical remaining work (not yet claimed as finished)
- Remote offsite backup target and actual isolated database/file restore drill.
- Independently proven historical backup retention/rotation, with no cleanup
  if the replacement backup failed or if only one recoverable copy remains.
- Production PM2 unit and PID ownership inspection before any service edit.
- Remote alerts: journald warnings alone are insufficient.
- Case/attachment dry-run candidate review with current real data and a
  fresh OFFSERVER backup before enabling automatic physical deletion.
- Regenerate a genuine certificate for exact modified source and follow
  existing safe atomic cutover gates; GitHub main and live VPS may differ.
- Verify September and October data reports AND individual latest rows,
  finance and file-preview operations after cutover.
- Re-enable disabled backup timers only after safe rotation is tested.

## Operational commands — inspection only
    systemctl show pm2-root -p Type -p PIDFile -p ExecStart -p ActiveState -p Result -p UnitFileState
    systemctl cat pm2-root
    pm2 pid kalpvriksha-backend
    test -f /root/.pm2/pm2.pid && echo PM2_PID_FILE_EXISTS || echo PM2_PID_FILE_MISSING
    systemctl is-enabled kalpavriksha-backup.timer kalpavriksha-database-backup.timer

Do not paste backend.env, access tokens, DATABASE_URL or PM2 jlist outputs.
