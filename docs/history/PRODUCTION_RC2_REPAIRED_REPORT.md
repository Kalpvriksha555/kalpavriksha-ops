# Kalpavriksha Production Candidate RC2 Repaired

## Purpose
This package restores the last known stable UI/application structure and removes the broken RC2 frontend replacement that caused the app to render as raw/default HTML.

## What was repaired
- Restored the original Vite React source structure under `src/`.
- Preserved the working Tailwind/global CSS imports:
  - `src/index.css`
  - `src/App.css`
  - `src/main.jsx`
  - `src/App.jsx`
- Preserved existing admin/team/security controls already present in the stable build:
  - Add Employee
  - Reset Password
  - Restrict / Allow Login
  - Delete Login
  - Change Role
- Preserved existing working backend/email/database logic.
- Removed reliance on the broken RC2 `frontend/` mini-app structure.
- Kept `.env` out of the package for safety.

## Important deployment note
Use this package as the application root. Do not copy the old broken RC2 `frontend/` folder over this build.

## After replacing files
1. Keep your working `.env` unchanged.
2. Fully stop backend and frontend.
3. Start backend.
4. Start frontend.
5. Hard refresh browser / clear Vite cache if needed.

## Validation focus after install
- Login page styling is restored.
- Dashboard layout and sidebar styling are restored.
- Chat opens without `isSystemOrInvalidTeamUser` crash.
- Team & Security controls are visible for admin.
- Add Employee is visible for admin.
- Presence/availability behaves as in the last stable working version.
