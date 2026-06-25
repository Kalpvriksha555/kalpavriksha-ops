# Kalpavriksha Designs Ops - Production Candidate RC1

## Scope completed
- Stability and integration pass over presence-sensitive modules.
- Security-safe cleanup of generated and environment files for delivery.
- Production build validation of the main frontend source.
- Backend syntax validation.
- Smoke checks for command centre, attendance, admin-only finance controls, calculator, search, uploads, WhatsApp sharing, and error boundary.

## Fixed / stabilized
1. Central online/offline presence parsing now accepts both numeric timestamps and ISO date strings.
2. Team Activity now uses the same real online test as Team Availability, Attendance, and Chat.
3. Offline users no longer remain Available/Drafting just because stale `isOnline` was true.
4. Direct chat removes invalid/system users and uses the same online dot logic.
5. `Faraz` and `Operations Manager` are excluded as system/non-team users.
6. Waqar and Khushbu normalization is preserved.
7. Attendance keeps admins hidden and shows non-admin team members.
8. Offline last seen uses date + time formatting.
9. A browser exit/page-hide offline marker was added to reduce stale availability after closing the browser.
10. Admin team controls remain preserved: add employee, reset password, restrict/allow login, delete login, and role change for non-admins.

## Validation performed
- `node node_modules/vite/bin/vite.js build` passed.
- `node scripts/smoke-check.mjs` passed.
- `node --check backend/src/server.js` passed.

## Important deployment notes
- Keep your working backend `.env` unchanged. It is excluded from this ZIP for safety.
- Restart backend and frontend fully after replacing files.
- Offline status can take up to around 90 seconds if a browser crashes or loses network without logout.
- For production, keep Gmail App Password private and never share it in chat/screenshots.

## Remaining live checks before final launch
- Login as Admin, Manager, Designer in separate browsers and verify presence in Team Activity, Attendance, Availability, and Chat.
- Close one browser without logout and confirm offline within about 90 seconds.
- Test Add Employee, Reset Password, Restrict Login, Allow Login, Delete Login, and Role Change.
- Create a case, assign it, start drafting, upload final file, mark complete, and share on WhatsApp.
- Test OTP email on the production domain after deployment.
