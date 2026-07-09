# Phase 25G – Preview Service Consolidation

Scope: stabilize the preview subsystem without changing task/chat/finance business logic.

## Changes
- Introduced one active preview entry point inside App: `openUnifiedFilePreview`.
- Kept `openProjectFilePreview` and `handlePreviewFile` as aliases only for compatibility.
- Exposed a global safety bridge `window.__kalpaOpenFilePreview` for hot-reloaded/legacy child paths.
- Updated chat attachment preview to use the single preview entry point or the safety bridge.
- Ensured chat `previewUrl/url` are inline-safe and `downloadUrl` is used only by the Download button.
- Prevented preview/open fallback from preferring `/download` URLs.

## Validation
- Frontend build passed.
- Backend syntax check passed.
- Project doctor passed.
- Regression guard passed.
