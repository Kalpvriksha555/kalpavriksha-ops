# Phase 15G – Average Time & Break Status Fix

## Fixed
- Performance average completion time now uses a wider timestamp fallback chain:
  - drafting start
  - work start
  - assigned time
  - created time
  - completion/approval/submission/upload timeline events
- Average no longer stays blank when completed task timestamps exist under alternate fields.
- Team Performance Cards now show clear live status:
  - Available
  - Working
  - On Break
  - Offline
- Break status is now visually highlighted with amber badge and pulsing dot.
- Break duration is shown in team cards, activity feed, leaderboard and CSV export.
- Team Activity duplicate status dot fixed.
- Performance export now includes Status and Break Today columns.

## Validation
- Frontend build passed.
- Backend syntax check passed.
