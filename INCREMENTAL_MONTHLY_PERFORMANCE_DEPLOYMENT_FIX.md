# Incremental Monthly Performance Deployment Fix

This hotfix corrects two deployment problems found after commit `c7a74bb`:

1. The previously supplied command still called the complete 22-gate deployment controller even though the revision changed only monthly analytics, reports, the performance baseline endpoint, and their integrity support.
2. The evidence-bounded same-count integrity repair rejected a hash-valid revision snapshot when only its redundant `entity_counts` metadata was stale, reporting `revision-counts-invalid`.

## Corrected integrity evidence

A state revision remains trusted only when its canonical snapshot hash matches the stored revision hash. Once that cryptographic check passes, entity counts are derived from the authenticated snapshot itself. Stale auxiliary revision-count metadata is reported but no longer invalidates an otherwise complete snapshot.

All remaining safeguards still apply. Repair is refused for count mismatches, invalid revision hashes, old or missing revisions, changed immutable business collections, non-finance task edits, unrelated payment changes, historical attendance changes, non-presence user changes, or non-append-only audit history.

## True latest-changes-only deployment

`scripts/deploy-monthly-performance-only-vps.sh`:

- targets only the current `origin/main` commit;
- leaves the live Git checkout untouched;
- runs only four tests related to monthly analytics, reports, baselines, and relational integrity;
- installs only frontend build dependencies;
- runs no full release matrix;
- runs no database migration;
- creates no additional full backup, but requires the recent verified full backup before the narrow metadata repair;
- installs no backend dependencies;
- replaces only:
  - `backend/src/server.js`
  - `backend/src/repositories/postgresStateRepository.js`
  - `frontend/dist`
- restarts only `kalpvriksha-backend`;
- restores the previous two backend files and frontend bundle if health checks fail.

## Verification

- 74 frontend tests passed.
- 135 backend tests passed.
- 209 combined tests passed.
- Targeted incremental deployment test passed.
- Backend JavaScript syntax passed.
- Incremental Bash deployment syntax passed.
