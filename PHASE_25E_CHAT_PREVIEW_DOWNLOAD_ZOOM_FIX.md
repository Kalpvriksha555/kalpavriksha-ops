# Phase 25E – Chat Preview, Download and Viewer Zoom Fix

## Fixed

- PDF/image preview zoom now changes the actual rendered viewer size instead of only changing the percentage label.
- Chat attachments now use inline preview URLs for display and preview actions.
- Chat PDFs no longer use embedded browser PDF objects that can trigger download-manager popups automatically.
- Restored Preview button for PDF/image chat attachments.
- Chat Open now opens preview for previewable files instead of forcing a raw/download URL.
- Download is now the only action that intentionally triggers a download.
- Sender/receiver chat PDF cards no longer auto-download just because the message is visible.

## Validation

- Frontend build passed.
- Backend syntax check passed.
- Project doctor passed.
