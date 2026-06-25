# Presence, Team Availability, Attendance, and Chat Final Fix

Applied fixes:

1. Backend presence protection
- Adds stale-presence cleanup on `/api/state` GET.
- Adds merge protection on `/api/state` POST so an older browser tab cannot overwrite a newer user heartbeat.
- Automatically marks users offline if their heartbeat is older than `PRESENCE_STALE_MS`.
- Default stale limit is 90 seconds.

2. Team Availability
- Available/Busy/Break/Offline now uses true heartbeat-based online status instead of only `isOnline`.
- Users who have not sent a recent heartbeat are moved to Offline.
- Admins still appear as Available when online, but do not show Free since.

3. Team Attendance
- Attendance now shows all approved non-admin users, even if they have no attendance log for the selected date.
- Online users show Online.
- Offline users show Last seen with date and time.
- Missing users such as Waqar/Khushbu will appear as long as their status is APPROVED and their role is not Admin.

4. Chat
- Chat sidebar now uses the same true heartbeat-based online status.

Important:
- Keep your working backend `.env` file. It is intentionally excluded from this ZIP.
- After replacing files, fully stop and restart backend and frontend.
- If a user closed browser without logout, they may stay online for up to 90 seconds, then automatically become offline.
