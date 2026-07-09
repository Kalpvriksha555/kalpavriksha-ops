# Phase 20B — Unified File Preview + Attendance Future-Date Fix

## Implemented

- Added a unified file preview flow for project files.
- PDF files now show Preview + Download actions.
- Image files now show Preview + Download actions.
- Preview modal supports:
  - PDF inline viewer
  - image lightbox-style preview
  - mobile-friendly layout
  - download from inside preview
- Backend `/api/files/:id/preview` now supports both PDF and common image formats.
- Chat attachments now show Preview for images and PDFs in addition to Open and Download.
- Attendance monthly sheet no longer marks future dates as absent.
- Future dates now show as grey upcoming cells.
- Today is visually separated from past/future dates.

## Scope

Touched only:
- frontend file preview UI
- chat attachment actions
- backend preview endpoint
- attendance monthly sheet cell rendering

## Verification

- Frontend build passed from `frontend/`.
- Backend syntax check passed for `backend/src/server.js`.
