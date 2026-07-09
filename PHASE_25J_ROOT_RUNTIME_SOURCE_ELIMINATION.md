# Phase 25J - Root Runtime Source Elimination

## Problem
Localhost was still loading a stale root-level React app source path, which contained older preview function references such as `openUnifiedFilePreview`. This caused runtime crashes even after the active frontend was fixed.

## Fix
- Removed root-level `src/` completely.
- Removed root-level generated `dist/` and cache/runtime folders.
- Updated root `package.json` scripts so `npm run dev`, `npm run build`, `npm run preview`, `npm start`, and `npm run serve` always execute the real app from `frontend/`.
- Kept only one active frontend source path: `frontend/src`.
- Verified no active stale preview source remains outside `frontend/src`.

## Important Local Apply Step
When applying this ZIP over an existing folder, delete the old folder first or manually remove root `src/` and root `dist/`. Extracting over an old folder does not delete stale files.
