# Modularization Phase 2 – Service & Utility Extraction

Scope was intentionally limited to low-risk frontend extraction only.

## Completed

- Added `src/config/appConfig.js` and `frontend/src/config/appConfig.js`
  - API base URL
  - backend-state flag
  - online stale timing
  - large inline data URL limit

- Added `src/utils/fileUtils.js` and `frontend/src/utils/fileUtils.js`
  - `fileToBase64`
  - `cleanFileName`

- Added `src/services/fileService.js` and `frontend/src/services/fileService.js`
  - backend file upload
  - backend file download
  - backend file delete
  - project file URL builder
  - profile/backend absolute URL builder
  - project file delete permission helper

- Added `src/services/otpService.js` and `frontend/src/services/otpService.js`
  - send OTP
  - verify OTP
  - OTP backend error handling

- Updated both root `src/App.jsx` and `frontend/src/App.jsx` to consume these extracted modules.

## Not Changed

- No task workflow logic changed.
- No chat logic changed.
- No attendance/presence logic changed.
- No backend route logic changed.
- UI behavior preserved.

## Validation

- Frontend build passed from `frontend/`.
- Backend syntax check passed.

## Next Recommended Phase

Phase 3 should extract role/user/team helpers from `App.jsx` into a dedicated `services/userService.js` or `utils/userUtils.js`, but only after this phase is tested in production/local environment.
