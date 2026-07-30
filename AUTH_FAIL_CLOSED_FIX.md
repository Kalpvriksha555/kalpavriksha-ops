# Local Auth Fail-Closed Fix

This update prevents stale React/HMR or cached workspace state from remaining visible when `/api/auth/session` returns `401` or the session check fails.

- Unauthenticated session checks now clear the current user, task data, finance data, chats, notifications, attendance, selected task, and role-scoped browser caches.
- Session bootstrap now updates the in-memory user reference only after a valid server session.
- The local JSON banner now clearly identifies an isolated local sandbox instead of implying that a production database snapshot is being used.
- A `401` from `/api/auth/session` before login is expected; the UI must now show the login screen rather than a stale dashboard.
