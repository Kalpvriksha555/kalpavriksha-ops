# Modularization Phase 11 — Backend Config & Upload Middleware

## Scope
This phase performs a conservative backend modularization pass without changing API behavior.

## Completed
- Extracted backend runtime paths into `backend/src/config/paths.js`.
- Extracted metadata constants and seed state into `backend/src/config/appMeta.js`.
- Extracted multer upload configuration into `backend/src/middleware/upload.js`.
- Updated `backend/src/server.js` to import these modules.

## Preserved
- Existing routes remain in `server.js`.
- Existing API behavior is unchanged.
- Existing upload storage path remains `backend/src/uploads`.
- Existing JSON fallback path remains `backend/src/data/db.json`.
- Existing PostgreSQL behavior is unchanged.

## Validation
- `node --check backend/src/server.js` passed.
- `node --check backend/src/config/paths.js` passed.
- `node --check backend/src/config/appMeta.js` passed.
- `node --check backend/src/middleware/upload.js` passed.
