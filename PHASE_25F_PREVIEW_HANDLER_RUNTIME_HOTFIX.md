# Phase 25F – Preview Handler Runtime Hotfix

## Issue
After the chat preview/download fix, some running/local builds could still hit a stale UI path that referenced `handlePreviewFile`, causing the app error boundary to show:

`handlePreviewFile is not defined`

## Fix
- Introduced `openProjectFilePreview` as the active preview handler.
- Updated file rows and chat preview wiring to call `openProjectFilePreview`.
- Kept `handlePreviewFile` as a compatibility alias for older/hot-reloaded UI paths.
- Confirmed frontend build passes.
- Confirmed backend syntax check passes.
- Confirmed project doctor passes.

## Notes
If the same error appears once after applying this ZIP, clear Vite/browser cache and restart dev server because that indicates the browser is still running an older hot-reload bundle.
