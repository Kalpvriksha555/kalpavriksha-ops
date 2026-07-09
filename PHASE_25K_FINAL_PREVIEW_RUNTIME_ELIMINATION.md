# Phase 25K – Final Preview Runtime Elimination

This pass was made from the exact ZIP that still produced `openProjectFilePreview is not defined`.

## Fixed
- Removed the stale root-level `src/` folder that still contained an older React app.
- Removed root `dist`, `.git`, `node_modules`, frontend `dist`, and backend/frontend `node_modules` from the package.
- Removed active runtime calls to `openProjectFilePreview` from `frontend/src/App.jsx`.
- Kept only the active in-scope preview function: `openUnifiedFilePreview`.
- Updated file rows and chat wiring to call `openUnifiedFilePreview` directly.

## Important local installation note
Do not extract this ZIP over the previous folder. Delete the old folder first, then extract. Otherwise Windows may keep stale `src/` or `dist` files that continue to crash the app.
