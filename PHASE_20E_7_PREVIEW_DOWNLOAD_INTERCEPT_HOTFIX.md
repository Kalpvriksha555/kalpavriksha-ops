# Phase 20E.7 – Preview Download Intercept Hotfix

Fixes localhost/browser download-manager interception where Preview could still show a download dialog for PDF streams.

## Root cause
Even with `Content-Disposition: inline`, some browsers/extensions/download managers intercept direct PDF/image HTTP streams from `/api/files/:id/preview`.

## Fix
- Added `/api/files/:id/preview-data` returning JSON/base64 for supported preview files.
- Frontend now prefers preview-data JSON and creates a typed in-memory Blob URL.
- PDF blob is forcibly typed as `application/pdf` even if the server/file record was `application/octet-stream`.
- Preview iframe/object no longer receives the raw server URL.
- Raw server preview URL is only used from explicit “Try browser preview”.

## Result
Clicking Preview does not navigate to or embed `/api/files/:id/preview`, so it should not trigger the external download prompt.
