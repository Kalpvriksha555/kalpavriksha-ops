# Attendance Engine V3 Release

This update replaces the attendance dashboard calculations with one canonical Attendance Engine V3 object.

## Fixed
- Summary cards, Live Team Status, Today's Insight, monthly sheet and CSV export now read the same V3 rows.
- Productive time is monotonic per user/day and no longer drops from a higher valid value to 0 during refresh or partial hydration.
- Productive time is capped by logged-in time, so impossible values are avoided.
- Presence, logged-in time, productive time, break time and idle time are calculated in one place.
- The UI labels now clearly show that the page is running Attendance Engine V3.

## Build verification
- Root frontend build passed.
- Frontend folder build passed.
- Backend syntax check passed.
