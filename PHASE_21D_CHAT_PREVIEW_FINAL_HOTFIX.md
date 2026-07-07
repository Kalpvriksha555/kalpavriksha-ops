# Phase 21D – Chat Preview Final Hotfix

## Fixed

- Chat image preview no longer opens the raw image page.
- Chat image thumbnail now opens the shared `UnifiedFileViewer` only.
- Preview button no longer falls back to `window.open()` for raw files.
- Chat attachments now prefer real file URLs over message IDs so message IDs are not mistaken for backend file IDs.
- Local/data/blob image previews open inside the viewer safely.
- Unified viewer locks body scroll while open.
- Viewer is forced above chat/actions/reactions/menus with top-layer z-index and isolation.
- Image preview remains inside the viewer with toolbar controls for zoom, rotate, fit, open, download, and close.
- Mobile chat attachment action buttons wrap cleanly.

## Validation

- Frontend build passed with Vite.
- Backend files were not changed.
- Preview/Chat/Performance changes are isolated to frontend preview/chat/service layer.
