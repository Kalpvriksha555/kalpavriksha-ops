# Kalpvriksha Production Candidate RC2

## Focus
This RC2 build focuses on stabilizing the existing approved workflow without redesigning or removing working features.

## Fixed
- Chat crash caused by missing/unsafe team-user filtering.
- Added a safe `isSystemOrInvalidTeamUser` helper and connected it to chat recipients and mentions.
- Chat direct-message list now uses only approved real team users: Admin, Manager, Designer.
- Removed invalid/system users from team-driven UI lists.
- Preserved Admin Team & Security controls:
  - Add Employee
  - Reset Password
  - Restrict / Allow Login
  - Delete Login
  - Change Role for Manager/Designer
  - View Analytics
- Repaired frontend production entry file (`src/main.jsx`) so the Vite production build works.
- Added Vite production config.
- Added a safe `re2js` browser shim for Firebase package compatibility during production builds.
- Removed duplicate code blocks that could cause unstable behavior:
  - duplicate `samePerson` declaration
  - duplicate incoming project sync call
  - duplicate current-user sync condition
  - duplicate attendance `activeMinutes` field
  - duplicate local save guard
- Rebuilt frontend production `dist` successfully.

## Preserved
- Current UI design and layout.
- Existing admin workflow.
- Existing email OTP setup.
- Existing `.env` behavior.
- PostgreSQL/database connection logic.
- Attendance, Team Activity, Team Availability, Chat, Notifications, and Admin Controls.

## Important
Your working `.env` file is not included for safety. Keep the same `.env` that already made Gmail OTP work.

## Tested
- Frontend production build: PASS
- Backend syntax check: PASS

## After replacing files
1. Keep your current `.env` unchanged.
2. Stop backend and frontend completely.
3. Restart backend.
4. Restart frontend.
5. Hard refresh browser.

## Final checks to perform live
- Open Chat as Admin, Manager, and Designer.
- Confirm only real team members appear.
- Confirm Shubham/Admin online dot appears to other users when logged in.
- Confirm Add Employee works.
- Confirm Reset Password works.
- Confirm Restrict Login blocks login.
- Confirm Allow Login restores login.
- Confirm Delete Login removes login.
- Confirm Change Role updates access correctly.
