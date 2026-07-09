# Phase 25Q - Chat Preview No-Download Repair

Fixed from current Phase 25P base.

## Changes
- Added backend `/api/files/:id/preview-data` JSON/base64 endpoint.
- Frontend preview now fetches preview-data instead of loading `/preview` directly.
- This prevents browser download managers/IDM from treating Preview as a download.
- PDF preview zoom now changes document zoom without shrinking the preview shell.
- Chat PDF preview remains inside unified viewer and keeps Download separate.
- Chat image preview keeps the same viewer toolbar with zoom/fit/rotate/download/close controls.
- Preview toolbar close button is kept visible and sticky.

## Validation
- Frontend build passed.
- Backend syntax check passed.
