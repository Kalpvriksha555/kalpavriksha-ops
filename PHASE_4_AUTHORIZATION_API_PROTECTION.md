# Phase 4 — Server-Enforced Authorisation and API Protection

Phase 4 removes the remaining browser-controlled trust decisions and makes the authenticated backend session the only source of identity and role authority.

## Central permission model

- Added a single Admin/Manager/Designer capability matrix.
- Added server-side task access and mutation checks.
- Designers receive only tasks currently assigned to them.
- Managers can create, assign, review and update operational work but cannot change finance or permanently delete tasks.
- Only Admin can modify finance, permanently delete tasks, manage accounts and use protected diagnostic functions.
- Permission denials receive explicit error codes and are written to the audit trail.

## Anti-spoofing controls

The backend ignores client-supplied role, sender, uploader, creator and finance-actor fields. The authenticated session supplies:

- Task creator/editor/assigner
- Finance updater
- Chat sender and role
- File uploader and role
- Notification creator
- Presence identity

The frontend no longer sends `currentUserRole`, chat uploader identity or file uploader identity.

## Scoped operational data

- Designer task payloads are assignment-scoped and finance-redacted.
- Non-Admin payloads omit payment collections and nested ledger fields.
- Direct chat messages are visible only to their participants, Admin and Manager.
- Private chat attachments inherit direct-message participants.
- Notifications can be read only by their intended user or role.
- Attendance records are self-scoped for Designers.
- Role changes clear browser operational caches before rehydrating the new permission scope.

## Protected mutation paths

Dedicated authorised endpoints now cover:

- Task create/update/delete
- Finance status and ledger updates
- Team chat send/edit/delete/read
- Notification create/read/read-all
- File upload/preview/download/delete
- Presence updates
- Account and system operations

The old whole-state endpoint accepts only authorised task records and ignores users, chat, notifications, payments, attendance, audit and deletion tombstones supplied by the browser.

## API hardening

- Strict trusted-origin CORS in production
- HTTP security headers and request IDs
- Global authenticated write-rate limits
- Separate login, recovery, OTP and email-test limits
- CSRF protection on every authenticated mutation
- Rejection of `__proto__`, `prototype` and `constructor` payload keys
- Bounded JSON bodies, arrays, strings and numeric values
- Default 100 MB per-file limit and 20-file request limit
- Minimal public health response without provider configuration details
- Authenticated private upload access

## Additional finance correction

Phase 4 runtime testing found a partial-payment defect: when an amount was below the estimate, the status became Pending but the received amount could be discarded. Partial receipts now remain in the case ledger and payment ledger with `PARTIAL` status, retaining date, mode, reference and actor details. Later task, review or assignment changes preserve that finance snapshot.
