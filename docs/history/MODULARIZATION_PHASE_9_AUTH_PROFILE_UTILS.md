# Modularization Phase 9 – Auth & Profile Utilities

This phase continues modularization without changing user-facing behavior.

## Extracted

- `utils/profileUtils.js`
  - profile photo URL normalization
  - profile photo cache-version helper
  - email/mobile normalization
  - email validation/masking
  - profile draft builder
  - profile save payload builder
  - password validation/update payload helpers
  - email/mobile registration payload helpers

- `services/profileService.js`
  - backend profile photo upload call

- `components/profile/index.js`
  - profile module re-export

## Updated

- `components/profile/ProfileView.jsx`
  - now uses extracted profile utilities and profile upload service

- `components/layout.jsx`
  - now uses shared profile photo URL helper instead of duplicate local media URL logic

## Scope

No backend logic was changed. Email OTP, profile photo upload/display, and profile save behavior should remain the same.
