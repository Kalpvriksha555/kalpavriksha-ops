# Phase 25H - Preview/File Subsystem Consolidation

- Removed duplicate root `src` app copy so Vite cannot run stale preview code.
- Root npm scripts now delegate to the single active frontend app in `frontend/`.
- Replaced remaining `openProjectFilePreview` / `handlePreviewFile` references with the single active `openUnifiedFilePreview` path.
- Kept Chat, Operations, Archive, and task detail file actions on the same shared viewer path.
- Removed build/cache folders and raw `.env` files from the distributable ZIP.
- Verified frontend build, backend syntax, doctor, guard, and production audit.
