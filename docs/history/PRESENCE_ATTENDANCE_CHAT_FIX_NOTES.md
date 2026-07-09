# Presence / Attendance / Chat Fix

Fixed issues:

1. Team Availability
- Available users are now calculated from real live heartbeat activity, not only the old `isOnline` flag.
- Users with stale heartbeat are treated as Offline automatically.
- Admins still appear in Team Availability.
- Admins do not show `Free since`.
- Non-admin users show `Free since` only when they are truly online and free.

2. Attendance
- Attendance now lists all approved non-admin users even if they have not logged in today.
- Logged-in/active users show `Online`.
- Offline users show `Last seen` with date and time.
- Last seen detection now supports both number timestamps and ISO date strings.

3. Chat
- Chat online/offline dot now uses the same real heartbeat logic.
- Online users no longer show offline just because their timestamp format changed.
- Stale users no longer show online forever.

Important:
- Keep the working backend `.env` file you already fixed. It is intentionally not included in this ZIP for safety.
- After replacing files, restart both frontend and backend.
