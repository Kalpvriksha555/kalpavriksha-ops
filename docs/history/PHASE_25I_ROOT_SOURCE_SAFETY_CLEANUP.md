# Phase 25I - Root Source Safety Cleanup

- Removed stale root `src/`, `public/`, and `dist/` paths that allowed Vite to serve an outdated app copy.
- Root npm scripts now delegate to `frontend/` so localhost always runs the active frontend.
- Prevents stale preview handler errors such as `openUnifiedFilePreview is not defined` from root source drift.
