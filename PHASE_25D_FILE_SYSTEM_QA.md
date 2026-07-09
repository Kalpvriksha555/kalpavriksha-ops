# Phase 25D – File System QA & Availability Repair

## Scope
Focused stabilization of project file records and file action rendering. No task, attendance, finance, chat, or performance business logic was intentionally changed.

## Fixes
- Added a shared file metadata normalizer in `frontend/src/services/fileService.js`.
- Added one shared file action-state resolver for Preview/Download availability.
- File rows no longer depend only on `doc.url`; they also use `downloadUrl`, `previewUrl`, `fileId`, and server file IDs.
- Source/working/completed file rows now show Preview/Download whenever any usable file link exists.
- Replaced misleading `Unavailable` file button with a clearer `Link missing` state only when no usable link exists.
- Backend upload/file registry now preserves both separate `previewUrl` and `downloadUrl` values.
- Backend file status response now includes preview and download URLs.
- Fixed visible UTF-8 mojibake in reassignment history arrow.
- Added file subsystem checks to regression guard and production audit.

## Verification
- Frontend build passed.
- Backend syntax check passed.
- Project doctor passed.
- Regression guard passed.
- Production regression audit passed.

## Notes
If an old file still shows `Link missing`, its database record exists but does not contain enough information to resolve the physical file. Re-uploading that file once will repair it permanently with the new file metadata model.
