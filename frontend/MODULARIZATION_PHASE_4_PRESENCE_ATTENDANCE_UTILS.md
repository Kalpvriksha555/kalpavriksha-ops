# Modularization Phase 4 – Presence & Attendance Utilities

Completed safely after Phase 3.

## Extracted
- `utils/presenceAttendanceUtils.js`

## Moved out of App.jsx
- Break-time calculation
- Active/completed work status helpers
- Busy-since helper
- Free-since helper
- Total logged-in time calculation
- Active attendance duration calculation
- Attendance accrual builder

## Safety
- UI behavior unchanged
- Presence rules unchanged
- Attendance rules unchanged
- Both active source roots updated: `src/` and `frontend/src/`
