# Phase 20E.2 - Unified Frontend File Preview Service

Implemented after Phase 20E.1 backend cleanup.

## What changed

- Centralized preview fetching in `frontend/src/services/fileService.js`.
- Added dedicated 24-hour preview cache separate from 7-day download cache.
- Added abort/cancellation support for preview requests.
- Added safe object URL cleanup helper.
- Updated task detail preview flow in `frontend/src/App.jsx` to:
  - cancel previous preview requests,
  - avoid duplicate preview requests,
  - clean object URLs on close/unmount,
  - reuse cached preview blobs instantly when available.

## Important behavior

- Preview still uses inline preview URLs only.
- Download still uses attachment/download URLs only.
- The frontend no longer treats download cache and preview cache as the same thing.
- Closing or switching previews now releases browser memory.

## Validation

- Frontend production build passed with `npm run build`.

## Scope intentionally not touched

- Attendance Engine V3.
- Finance logic.
- Archive/Operations filtering.
- Chat workflow.
- Performance scoring.
