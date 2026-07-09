# Phase 22G – Stability Audit & Duplicate Cleanup

Scope: full project cleanup, not only task creation.

## Fixed
- Removed duplicate active root `src/` and root `public/` trees.
- Root Vite build now uses the canonical `frontend/src` and `frontend/public`.
- Removed stale `dist/`, `frontend/dist/`, `node_modules/`, `frontend/node_modules/`, `.git`, release artifacts, and backup source files.
- Kept one canonical frontend source path to avoid root/frontend drift.
- Hardened Create Task modal as a global portal above all app layers.
- Locked background scrolling while Create Task is open.
- Added mobile-safe Create Task layout rules.
- Removed raw chat image preview duplication by keeping shared viewer path.

## Verification
- Root build path: `npm run build`.
- Frontend build path: `cd frontend && npm run build`.
- Backend syntax check: `node --check backend/src/server.js`.

## Deployment note
Use normal install commands after extracting this ZIP. Do not copy old `node_modules` or old `dist` folders back into the project.

## Completed checks in this package
- Root build passed before cleanup.
- Frontend build passed before cleanup.
- Backend syntax check passed.
- Backup source file count: 0.
- Stale runtime folders removed: `.git`, `node_modules`, `frontend/node_modules`, `dist`, `frontend/dist`.
- Active frontend source folder: `frontend/src` only.
