# Phase 25T – Chat Preview Toolbar + No Download Fix

Focus: fix chatbox previews so they use the same visible toolbar behavior as source-file previews.

Changes:
- Viewer close button is now pinned and always visible.
- Zoom out / zoom in / fit / rotate controls remain visible for chat image and PDF previews.
- Toolbar no longer hides critical controls off-screen.
- Preview errors no longer expose raw `/preview` fallback URLs.
- If `/preview-data` is unavailable, preview fetches `/preview` as a Blob and renders a Blob URL instead of passing the raw URL to iframe/window.open.
- Download still runs only from the Download button.

Validation:
- Frontend build passed before packaging.
