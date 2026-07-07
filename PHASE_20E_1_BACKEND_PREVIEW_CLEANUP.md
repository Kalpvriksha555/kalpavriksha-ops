# Phase 20E.1 Backend Preview Cleanup

Implemented a focused backend cleanup for the unified file preview system.

## What changed

- Consolidated file serving into one shared backend response path.
- `/api/files/:id/preview` now always sends `Content-Disposition: inline`.
- `/api/files/:id/download` now always sends `Content-Disposition: attachment`.
- Legacy `/api/files/:id?mode=preview` and `?mode=download` remain as compatibility wrappers, but both now use the same shared backend logic.
- File registry entries now include both `previewUrl` and `downloadUrl`.
- `/api/files/:id/status` now returns `previewUrl`, `downloadUrl`, `mime`, and `size`.
- Preview cache is set to 24 hours.
- Download cache is set to 7 days.
- DWG and unsupported formats return metadata instead of forcing a browser download.

## Validation performed

- Backend syntax check passed with `node --check backend/src/server.js`.
- Backend started successfully with JSON fallback when `DATABASE_URL` was blank.
- Header test confirmed:
  - Preview endpoint returns `Content-Disposition: inline`.
  - Download endpoint returns `Content-Disposition: attachment`.

## Notes

Frontend unification is intentionally not changed in this phase. Phase 20E.2 should update the frontend file service so all preview buttons prefer `previewUrl` and never reuse `downloadUrl` for preview.
