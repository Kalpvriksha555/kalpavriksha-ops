# Phase 22F – Mobile Layout Core Fix

Focused fix for the mobile clipping/overlap shown in 400px responsive mode.

## Fixed
- Added global mobile overflow guardrails to stop horizontal clipping.
- Create Task modal is forced to 100dvw/100dvh on mobile.
- Create Task modal fields are constrained to one column on mobile.
- Modal top header and bottom Create button remain reachable.
- Fixed bottom sticky submit bar on mobile safe-area devices.
- Added padding so task detail action buttons are not hidden behind bottom nav/floating chat.
- Task detail action buttons stack full-width on mobile.
- Floating chat button is lifted above bottom navigation on mobile.
- Synced root `src` and `frontend/src` copies for the touched files.

## Validation
- Frontend production build passed.
