# Phase 20E.6 - Enterprise Integration & Preview Rollout

## Scope
Stabilized the unified preview system and expanded shared viewer usage without changing Attendance Engine V3, Finance logic, Archive logic, Operations workflow, or backend file routing.

## Implemented
- Chat attachment Preview now uses the shared `UnifiedFileViewer` for all previewable files, not only PDF/images.
- Removed the inline chat `<object>` PDF embed that could request the download URL directly.
- Added viewer keyboard shortcuts:
  - Esc: close
  - Left / PageUp: previous page region
  - Right / PageDown / Space: next page region
  - Ctrl/Cmd + +: zoom in
  - Ctrl/Cmd + -: zoom out
  - Ctrl/Cmd + 0: fit page/reset zoom
  - Ctrl/Cmd + F: focus viewer search field
- Added session-level viewer memory per file:
  - zoom
  - rotation
  - fit mode
  - image pan
  - estimated page
  - scroll position
- Added PDF page-region controls and page estimate display.
- Added text search field and match counter for text/CSV/JSON/XML/LOG previews.
- Improved loading skeleton and open animation.
- Kept global portal z-index at `2147483000` so it remains above chat, finance, drawers, sidebars, dialogs, and menus.
- Preserved preview/download separation: Preview does not download; Download only runs from explicit download controls.

## Validation
- Frontend production build passed.
- Backend syntax check passed.
- No Attendance Engine V3 changes were made.
