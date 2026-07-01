# Attendance Engine v2 – Active Window Fix

This patch corrects the attendance active-time calculation.

## Fixed
- Active Duration now counts only task-busy intervals that overlap the selected day's logged-in session window.
- A user with no login record for the selected date cannot show task active time.
- Active Duration is capped so it can never exceed Total Logged-in time.
- Offline/previous-day tasks no longer leak active time into the current attendance date.
- Admin users remain excluded from attendance logged/active calculations.

## Logic
- Logged-in Time = session start to session end.
- Active Duration = assigned-task busy overlap inside that session window only.
- Break Time remains separate.
