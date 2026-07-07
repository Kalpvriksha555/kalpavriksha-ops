# Phase 21E — Desktop Preview Toolbar Fix

Focused fix after chat attachment image preview opened correctly but showed only Open/Download/Close on desktop.

## Updated
- Added a persistent desktop toolbar in the unified preview footer for PDF/image previews.
- Added clickable desktop buttons:
  - Zoom Out
  - Zoom In
  - Zoom percentage
  - Fit Page
  - Fit Width
  - Rotate
  - Reset image position
  - Previous
  - Next
- Kept existing mobile bottom toolbar intact.
- Kept keyboard shortcut hints visible on desktop.
- No backend, chat logic, attendance, archive, operations, finance, or performance engine logic changed.

## Validation
- Frontend build passed with Vite.
