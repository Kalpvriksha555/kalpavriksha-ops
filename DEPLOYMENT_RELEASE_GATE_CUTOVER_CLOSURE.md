# Kalpavriksha 1.9.28 — Atomic Frontend / Release Gate Closure

## Production failure closed

The 1.9.27 deployment correctly removed the stale `backend/backend` source tree and proved exact release/live source parity. The permanent release gate still failed one step later because the atomic frontend switch temporarily renamed the old generated build to `frontend/dist.previous`. `sourceTreeHash()` ignored `dist` but not `dist.previous`, so a generated rollback build artifact was incorrectly counted as release source.

## Permanent corrections

- `sourceTreeHash()` now excludes `frontend/dist`, `frontend/dist.next`, and `frontend/dist.previous` as generated build artifacts.
- Permanent source/certificate verification runs once before the frontend build-artifact switch and again after it.
- The second gate proves that atomic frontend rollback artifacts cannot invalidate certified source.
- 1.9.27 deployment entrypoints are disabled in this package.
- All 1.9.27 source-parity cleanup, 1.9.26 deployment lock/backup convergence, and 1.9.25 relational integrity protections remain active.

No database restore or operational-row rewrite is performed by this fix.

## Rollback source parity hardening

The deployment now also snapshots the permanent live source tree before downtime, excluding generated dependencies, frontend build outputs, environment files and runtime storage. If a failure occurs after permanent-source synchronization, rollback restores that prior source snapshot before restoring the previous frontend build, certificate and PM2 backend. This prevents a failed cutover from leaving new source files at the permanent path while an older immutable runtime is serving traffic.
