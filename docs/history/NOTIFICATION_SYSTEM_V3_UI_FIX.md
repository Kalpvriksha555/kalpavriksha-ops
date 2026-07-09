# Notification System v3 UI Fix

Focused fix for the screenshot-reported notification UI issues.

## Fixed
- Incoming toast notifications now use a dedicated top-most z-index layer.
- Toasts no longer appear behind the notification dropdown/panel.
- Notification dropdown has its own controlled layer below toasts.
- Bell unread badge now supports 1, 2 and 3-character counts (`99+`) without clipping.
- Badge spacing, position, padding and numeric rendering were refined.
- Mobile notification dropdown/toast placement is safer and viewport-bound.

## Scope
Only notification UI layering and badge presentation were changed.
No task, attendance, file, profile, chat-message, backend, or business logic was changed.

## Validation
- Backend syntax check passed.
- Frontend production build could not be run because `vite` is not installed in the extracted ZIP environment.
