# File Storage v2 Download Fix

Focused fix for uploaded files showing `File missing on server` during download.

## Fixed

- Generic `/api/files/upload` now persists file metadata immediately into a server-side file registry.
- `/api/files/:id/download` now resolves files from:
  - file registry
  - case documents
  - completed files
  - chat attachments
  - legacy file records
- Added backward-compatible filename matching for older records that only saved the original filename.
- Added `/api/files/:id/status` for future availability checks.
- Download response now returns a clearer `410 File unavailable` when the database record exists but the physical file is genuinely missing.
- Delete route now also removes file registry records.
- Frontend now shows a clear re-upload message instead of silently opening a broken download.

## Important

This fixes current and future uploads by keeping a reliable registry and resolving old formats better. If a file was uploaded to an ephemeral server and the physical file was deleted by redeploy/restart, that exact file cannot be recreated automatically; it must be re-uploaded once.
