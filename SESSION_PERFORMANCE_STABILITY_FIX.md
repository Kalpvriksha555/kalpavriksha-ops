# Session, Login and Performance Stability Fix

Release versions:

- Root: `1.9.13-session-performance-stability`
- Backend: `2.9.13-session-performance-stability`
- Frontend: `2.9.13-session-performance-stability`

## Problems corrected

### Browser refresh and reopening

The previous implementation used a persistent twelve-hour cookie and restored `/api/auth/session` during application startup. That made a refreshed or reopened browser return to the last signed-in workspace.

The corrected release:

- uses a browser-session cookie without `Max-Age` or `Expires`;
- revokes any previous page session through the idempotent `POST /api/auth/clear-browser-session` startup endpoint;
- clears the protected frontend workspace before any state hydration;
- keeps the CSRF credential only in memory and deletes the obsolete local-storage copy;
- requires a fresh login after refresh or reopening the page; and
- limits stale-session cleanup to eight seconds so a backend fault cannot leave the browser on an indefinite startup screen.

### Login restrictions and failed-attempt locks

The previous login order rejected an automatically locked credential before checking whether the supplied password was correct. A valid employee could therefore remain blocked after earlier typing mistakes.

The corrected release:

- verifies the password before applying the automatic failed-attempt lock;
- clears `failed_attempts` and `locked_until` when the correct password proves account ownership;
- preserves deliberate `RESTRICTED` account status and continues to require Admin **Allow Login**;
- makes Admin **Allow Login** clear any stale automatic lock in both user and credential state;
- preserves established migrated passwords without forcing a password replacement; and
- retains mandatory replacement only for administrator-created or administrator-reset temporary passwords.

### State-read performance

The previous `/api/state` path cloned the full operational state multiple times, returned duplicate collections, rebuilt performance analytics during polling, and repeatedly serialized large workspace snapshots into browser storage.

The corrected release:

- uses an immutable read path for authorized GET requests;
- supports compact state responses without duplicate `cases/projects` and `teamChat/chatMessages` aliases;
- requests performance records only during initial hydration, not every background refresh;
- caches computed performance bundles by state version;
- clones only role-visible cases for sanitization;
- avoids repeated full production project/chat serialization to local storage;
- pauses global clock work on non-operational screens; and
- applies in-flight backpressure to workspace refresh, heartbeat, task retry and upload flows.

### PostgreSQL write performance

The previous selective write path reread all relational tables and wrote a complete state revision for routine task/file activity.

The corrected release:

- keeps a committed relational shadow state synchronized after each successful transaction;
- uses that shadow to prepare selective row writes without rereading every table;
- writes only selected task, file, attendance, presence or authentication rows where applicable;
- uses periodic complete revision snapshots for high-frequency task/file writes;
- retains immediate revision snapshots for finance, deletion, authentication and full-state operations; and
- reloads committed PostgreSQL state and preserves dirty presence data after a failed transaction.

## Operational behavior

- Refreshing the web application signs out the current page session.
- Closing and reopening the website starts signed out.
- A correct password clears an automatic failed-attempt lock.
- An intentionally restricted account remains blocked until Admin selects **Allow Login**.
- Task creation and file upload keep finite deadlines and do not wait behind repeated heartbeat full-state writes.
