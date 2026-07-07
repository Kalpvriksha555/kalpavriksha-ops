# Attendance UX + Backend Consistency Polish

Implemented focused fixes for the Attendance module.

## Fixed
- Login now creates/updates today's attendance row immediately.
- First login is preserved for the day instead of being overwritten.
- Last seen is no longer mixed from an old day into today's attendance row.
- Backend `/api/state` now normalizes attendance logs before saving:
  - rejects mismatched login/logout timestamps from another date,
  - prevents logout before login,
  - deduplicates attendance rows,
  - preserves safe first-login data.
- Attendance page now uses backend-safe session calculation for First Login, Last Seen, Logged-in Time, Productive Time and Break Time.

## UX/UI Polish
- HR-style summary cards.
- Clear statuses: Working, Online / Idle, On Break, Offline, No Login.
- Renamed Active Duration to Productive Time.
- Added idle/warning labels such as No login record and No active task time.
- Added readable timeline: first login → live/offline.
- Added productive ratio bar.
- Added mobile-friendly employee cards.
- Added Today’s Insight and metric explanations.
