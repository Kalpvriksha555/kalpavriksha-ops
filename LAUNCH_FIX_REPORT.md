# Launch Fix Report

Applied final launch fixes:

- Deleted cases are now removed immediately from the UI and persisted to backend/PostgreSQL app_state via DELETE /api/state/projects/:id.
- Deleted/restricted user logins are now available for Admins for managers/designers.
- Admins cannot restrict/delete other Admins from this control.
- Restricted/deleted users cannot login.
- Created date now includes time on task/case lists for easier tracing.
- Added explicit backend state delete endpoint.
- Production frontend build passed.
- Backend syntax check passed.

Notes:
- Email OTP requires a configured email provider in backend/.env: EMAIL_PROVIDER plus credentials.
- PostgreSQL is active when DATABASE_URL is present in backend/.env.
