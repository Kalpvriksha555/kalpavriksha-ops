# Phase 17D — Performance Summary Frontend Stabilization

## Goal
Make the Performance Analytics page consume the backend performance summary as the primary source of truth instead of recalculating or falling back to task-level values first.

## Implemented
- Wired user cards to `performanceSummary.users` first.
- Wired Avg Completion to backend summary first.
- Wired Avg Review to backend summary first.
- Wired SLA, revision rate, productivity score, and case-type timings to backend summary first.
- Added analytics source/diagnostic strip so it is visible whether data is coming from backend history records or generated task records.
- Added per-user timing source and history count in performance cards.
- Kept local task fallback in place so the page still works if the backend summary is unavailable.

## Validation
- Frontend production build passed.
- Backend syntax check passed.
