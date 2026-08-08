# Archived historical recovery note

> Do not execute the old July 30 deployment launchers. They have been removed. Use `scripts/deploy-1.9.24-vps.sh` for the current release. The content below is retained only as historical recovery context.

# July 30 Safe Recovery

This release fixes the stale-snapshot deployment failure that hid July 30 operations.

## Verified recovery evidence

- Export: `kalpvriksha-finance-recovery-1785402249604.json`
- File SHA-256: `51DB407B8F1BF7BAEECDDD37CAEDF5C503EA2F7716B8BFF270F0BF669AB455DA`
- Exported: 30 July 2026 at 2:34:09 PM IST
- Tasks: 404 unique records
- Tasks active after 29 July 2026 at 1:00 PM IST: 34
- Latest valid activity: 30 July 2026 at 2:19:27 PM IST

The recovery refuses a different file, count, duplicate ID, stale cutoff, or timestamp later than the export. It understands both legacy Indian `DD/MM/YYYY` timestamps and browser-locale `MM/DD/YYYY` timestamps.

## Data-preservation rules

- A verified full PostgreSQL and private-file backup is created before the merge.
- Application writes are stopped during plan/apply.
- Missing tasks are added by stable task ID.
- For an existing task, the freshest valid operational record wins.
- Timeline, history, document metadata, revisions, comments, and assignment history are unioned.
- Live finance fields always win when present.
- Live attendance and every other non-project state collection must have identical pre/post hashes.
- A PostgreSQL state revision records the recovery.
- A failed post-write verification automatically writes the original state back as a new revision.
- A second verified full backup is created after recovery.

The browser export did not contain attendance. The process preserves the live attendance table exactly and locally backs up Chrome/Edge site storage before connecting to the VPS. It does not invent missing attendance records.

## Controlled deployment

Run from Windows PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
# Historical command removed; do not run.
```

The script prompts for VPS authentication, deploys only the verified Git commit, downloads pre/post recovery backups to `D:\Kalpavriksha-Recovery-Backups`, fast-forwards GitHub `main`, and aligns the normal VPS checkout only after health and data checks pass.
