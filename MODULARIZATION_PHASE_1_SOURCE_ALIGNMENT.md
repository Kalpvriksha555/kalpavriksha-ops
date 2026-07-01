# Modularization Phase 1 — Source Alignment

## Purpose
This phase does not change product behavior. It prepares the project for safer modularization by removing ambiguity between the two frontend source trees:

- `src/`
- `frontend/src/`

Both trees existed and had drifted, which made it risky to know which version Vercel or local builds were using. This phase aligns them so either build target uses the same current UI and logic.

## Completed
- Synced `frontend/src/` into root `src/`.
- Synced `frontend/public/` into root `public/`.
- Preserved all stabilized fixes from the latest production polish:
  - archive completed-file display
  - task description + estimate visibility
  - chatbox polish
  - notifications polish
  - attendance/presence improvements
  - profile/email/file fixes
- Added this documentation file to mark the exact modularization restart point.

## What was intentionally not changed
- No backend logic changes.
- No database changes.
- No task workflow changes.
- No UI redesign.
- No feature behavior changes.
- No deletion of either frontend tree yet, because deployment root configuration should be confirmed first.

## Next modularization step
Phase 2 should extract shared helpers from `App.jsx` into focused utility modules, starting with low-risk pure functions:

- task display helpers
- file helpers
- date/time helpers
- role/permission helpers
- presence helpers

This keeps the app deployable after every phase.
