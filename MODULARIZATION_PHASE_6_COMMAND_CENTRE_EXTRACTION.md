# Modularization Phase 6 — Command Centre Extraction

## Scope
Focused extraction of the Command Centre UI into its own feature module.

## Done
- Created `components/command-centre/CommandCentreView.jsx`.
- Created `components/command-centre/index.js`.
- Moved Command Centre presentation and local presence display logic out of `App.jsx`.
- Kept the existing UI and behavior unchanged.
- Kept both `frontend/src` and root `src` synced.

## Validation
- Frontend production build passed from `frontend/`.

## Notes
This phase reduces the size of `App.jsx` while keeping the stabilized presence, attendance, task, archive, chat, and notification behavior intact.
