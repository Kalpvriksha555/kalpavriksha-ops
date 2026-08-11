# Phase 24 systemd handoff timeout closure — 2026-08-11

## Live evidence

The real VPS transient final-release unit was created with `Type=exec` and `TimeoutStartSec=0`, then systemd immediately reported `start operation timed out`, sent SIGTERM, and consumed only 1 ms CPU. The integrated certification/deployment script therefore never began and production remained untouched. The previous `/root/kalpavriksha-final-release-last-unit` pointer also remained stale because it was written only after the blocking `systemd-run` call returned.

## Closure

Both current systemd launch boundaries now enqueue with `systemd-run --no-block`, use `TimeoutStartSec=infinity`, durably record the new unit name, and explicitly poll `ActiveState` for up to ten seconds. Immediate transient-unit failures are reported as failures; the operator is told that the pipeline started only after the unit is proven active. The inner guarded production deployment launcher has the same protection so the same race cannot recur after candidate certification.

No production database, task, attendance, finance, payment, ledger, private-file, retention, migration, or application write path is changed by this hotfix. Existing fresh-FULL-backup-before-production-certification and no-automatic-database-restore rollback protections remain unchanged.
