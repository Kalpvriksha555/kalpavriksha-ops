# Presence, Team Availability, Attendance, and Team Activity Final Fix

This package fixes the repeated presence issue across all visible sections:

- Team Availability no longer marks stale users as Available after heartbeat expires.
- Team Activity now uses the same real online check instead of raw `isOnline`.
- Chat/attendance/availability use a shared 90-second active-session window.
- Last-seen values now support both numeric timestamps and ISO date strings.
- Default approved non-admin users are merged back into attendance so Waqar and Khushbu do not disappear when the backend state is incomplete.
- Offline users show last seen with date and time.

Important after replacing files:

1. Keep your working `.env` unchanged.
2. Fully stop and restart backend.
3. Fully stop and restart frontend.
4. Hard refresh browser once.
5. A user who closes the browser without logging out may take up to 90 seconds to become Offline/Unavailable.
