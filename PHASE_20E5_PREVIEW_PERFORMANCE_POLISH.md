# Phase 20E.5 - Unified Preview Performance Polish

Implemented safely on top of Phase 20E.4.

## Changes

- Added in-flight preview request de-duplication in the shared file service.
- Kept preview and download logic separate.
- Reused active preview reads to avoid duplicate network/cache work.
- Preserved 24-hour preview cache and 7-day download cache.
- Added image drag/pan support in the global viewer.
- Added pinch zoom support for touch devices.
- Added Ctrl + mouse wheel zoom for image previews.
- Added pan reset support.
- Exposed zoom/fit/rotate controls for PDF/image viewer toolbar where safe.
- Kept browser-native PDF rendering to avoid adding heavy dependencies or destabilizing the build.
- Maintained single global portal with maximum z-index overlay.

## Validation

- Frontend production build completed successfully using Vite.
- No backend changes made in this phase.
- Attendance Engine V3 and Performance Engine files were not modified.
