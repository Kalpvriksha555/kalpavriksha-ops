# Kalpvriksha Production Stabilization Notes

This package focuses on connecting the existing workflow without redesigning the UI.

## Fixed
- Removed non-team placeholder users from chat/team views, including Faraz and Operations Manager placeholders.
- Chat direct-message list now uses the same approved team-member filter as Team, Attendance, and Team Activity.
- Admins remain visible in chat and availability; Shubham Admin and other admins show online indicators when active.
- Presence logic is shared through the same `isUserActuallyOnline` / backend sanitized state flow.
- Team & Security Control keeps Add Employee, Reset Password, Restrict Login, Delete Login, and role-change controls for Admin users.
- Backend seed data now matches the real Kalpvriksha team instead of generic placeholder users.
- Backend state sanitization prevents Operations Manager/Faraz-style placeholders from reappearing across roles.
- Attendance continues to hide admins while showing all approved non-admin users.

## Important
Keep your working backend `.env` unchanged. It is intentionally not included in this ZIP.

After replacing files, restart backend and frontend fully.
