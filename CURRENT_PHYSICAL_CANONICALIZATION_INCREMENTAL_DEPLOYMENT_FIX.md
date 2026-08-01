# Current Physical Canonicalization Incremental Deployment Fix

## Production failure addressed

The previous incremental deployment compared the current PostgreSQL state to an older revision snapshot. It correctly found legitimate later changes in performance records, team chat, files, and chat reads, but then refused the deployment as `business-collection-changed`.

That comparison cannot establish the current source of truth after ordinary production activity. This release removes that historical comparison from the incremental cutover path.

## Safe cutover sequence

The dedicated incremental script now:

1. fetches and extracts only the latest GitHub commit without changing the live checkout;
2. runs only the analytics, reports, baseline, integrity, and incremental-deployment tests;
3. installs only frontend build dependencies and builds the frontend;
4. verifies the already-created recent full PostgreSQL/private-files backup before downtime;
5. stops PM2 and verifies port 8080 is closed;
6. takes an advisory lock and read locks on every operational relational table;
7. requires metadata counts, reconstructed counts, and direct physical PostgreSQL counts to match exactly;
8. requires the complete physical state to survive an independent canonical round trip;
9. writes only a new canonical revision, integrity metadata, and an operational evidence event;
10. replaces only `backend/src/server.js`, `backend/src/repositories/postgresStateRepository.js`, and `frontend/dist`;
11. restarts PM2 and requires liveness and readiness.

It does not run the full release matrix, migrations, a new full backup, backend dependency installation, release certification, or clean-install verification. It does not rewrite tasks, users, payments, performance records, chat, files, attendance, notifications, or any other operational row.

## Rollback

Before downtime, the current two backend runtime files and frontend build are copied to a timestamped rollback directory. Any failure after PM2 is stopped restarts the previous backend. Any failure after file switching restores the previous backend files and frontend before restart.
