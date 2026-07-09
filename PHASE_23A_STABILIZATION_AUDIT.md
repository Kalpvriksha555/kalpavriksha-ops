# Phase 23A – Project Stabilization & Duplicate Cleanup

## Scope
This phase does not add new features. It stabilizes the codebase and removes sources of accidental regressions.

## Completed
- Moved old phase notes and historical reports from the project root into `docs/history/` so they cannot be confused with active runtime files.
- Removed raw `.env` files from the distributable ZIP and added safe `.env.example` files.
- Added `scripts/doctor.mjs` to detect harmful duplicate source paths, raw env files, cache/build folders, missing core files, and duplicate Create Task modal paths.
- Added Windows and Linux/macOS local cleanup scripts:
  - `scripts/clean-local-cache.ps1`
  - `scripts/clean-local-cache.sh`
- Fixed root Tailwind content paths so root builds scan `frontend/src` correctly.
- Kept one active frontend source path: `frontend/src`.
- Verified there is only one active `App.jsx`.
- Verified Create Task uses one global portal path.
- Replaced Create Task browser alert fallback with an inline error message area.
- Kept backend, attendance, preview, operations, archive, finance, and chat logic untouched except for the safe Create Task error display.

## Validation
- `npm run doctor` passed.
- Root `npm run build` passed.
- `frontend/npm run build` passed.
- Backend syntax check passed with `node --check backend/src/server.js`.

## Notes
Use the project root as the preferred build path. The `frontend/` path remains usable for compatibility, but active source remains `frontend/src` only.
