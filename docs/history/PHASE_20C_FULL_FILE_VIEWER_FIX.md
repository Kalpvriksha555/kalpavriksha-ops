# Phase 20C – Full In-App File Viewer Fix

Implemented a more reliable file preview system after the blank preview issue.

## What changed

- Replaced direct iframe URL preview with a safer blob-based preview loader.
- Added a unified backend endpoint:
  - `GET /api/files/:id?mode=preview` for inline preview
  - `GET /api/files/:id?mode=download` for attachment download
- Kept existing endpoints working:
  - `/api/files/:id/preview`
  - `/api/files/:id/download`
- PDF preview now fetches real file data first and only then opens the viewer.
- Image preview now supports:
  - zoom in/out
  - rotate
  - open in new tab
  - download
- Preview error state now clearly explains backend/file issues instead of showing a blank white box.
- Download remains available from inside the preview modal.
- Attendance sheet future-date behavior remains fixed: future dates show as upcoming, not absent.

## Why this fixes the blank preview

The previous viewer opened the preview endpoint directly in an iframe. If the backend returned JSON, text, an auth error, a wrong MIME type, or a failed file path, the UI showed a blank preview area.

The new viewer validates the response first, confirms a real file blob exists, creates a safe browser object URL, and then renders that object URL inside the preview modal.

## Notes

Backend syntax check passed.
Frontend build could not be run in this environment because `node_modules`/Vite are not installed in the active sandbox and dependency installation timed out. The code changes are localized to file preview and backend file streaming.
