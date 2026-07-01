# Attendance Engine v2 Fix

Focused fix for incorrect attendance time calculations.

## Fixed
- Offline users no longer continue accumulating Total Logged-in time after logout.
- Online users with missing/stale attendance log totals now derive Total Logged-in from their live session start.
- First Login can be recovered from the user's session when the attendance row is incomplete.
- Active Duration now uses a safer derived value instead of staying at 0 when session totals are missing.
- Attendance summary cards and export use the same derived session calculation.

## Main files changed
- `src/utils/presenceAttendanceUtils.js`
- `frontend/src/utils/presenceAttendanceUtils.js`
- `src/App.jsx`
- `frontend/src/App.jsx`

## Validation
- Frontend production build passed after fixing local vite executable permission.
