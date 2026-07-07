# Phase 21B – Chat Preview Layering Fix

Focused hotfix after Phase 21A.

## Fixed
- Unified file viewer now uses maximum safe z-index so it always opens above Team Chat and chat menus.
- Viewer panel also gets explicit z-index to prevent the content area from sitting behind chat overlays.
- Image preview container is constrained to the viewer height so images do not spill behind chat.
- Chat attachment thumbnail click now opens the unified viewer instead of opening the raw image URL.

## Not touched
- Attendance Engine V3
- Operations
- Archive
- Finance
- Backend preview/download logic
- Performance analytics logic

## Validation
- Frontend production build passed.
