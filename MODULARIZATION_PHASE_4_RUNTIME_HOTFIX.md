# Modularization Phase 4 Runtime Hotfix

Fixed login-time runtime error:

`getUserActiveTasks is not defined`

Cause: Phase 4 extracted presence/attendance helpers into `utils/presenceAttendanceUtils.js`, but `App.jsx` was still calling the extracted helpers without importing them.

Applied fix:
- Added missing presence/attendance utility imports in `frontend/src/App.jsx`
- Added same import in root `src/App.jsx`
- No feature logic changed

Affected helpers:
- `getUserActiveTasks`
- `getUserBusySince`
- `getUserFreeSince`
- `getUserLastCompletedAt`
- `getTaskBusySince`
- `getBreakMinutesFromLog`
- `getTotalLoggedInMinutesFromLog`
- `getActiveMinutesFromLog`
- `buildAttendanceAccrual`
