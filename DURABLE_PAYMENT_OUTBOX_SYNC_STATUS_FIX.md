# Durable Payment Outbox and Sync Status Fix

## Purpose

Payment-ledger edits must remain recoverable when an administrator enters many payments, navigates away, loses connectivity, closes the tab, closes the browser, or reopens the application before every request has received a server response.

## Implemented behaviour

- Every finance edit is synchronously written to an actor-scoped durable browser outbox before the normal autosave debounce begins.
- The outbox is mirrored under two local-storage keys and each complete mirror carries a monotonically increasing generation. Recovery selects the newest valid complete generation, so a stale mirror cannot resurrect a mutation that the backend already confirmed.
- A queued record retains the task identity, sanitized ledger draft, expected finance version, stable mutation ID, retry state, attempts and last error.
- A response lost during tab/browser closure is safe: reopening retries the same mutation ID, allowing the backend idempotency path to return the already committed result without creating a duplicate payment update.
- Newer edits made while an older request is active receive a new mutation ID. Confirmation of the older mutation advances the newer record's expected finance version instead of deleting it.
- Pending records are retried sequentially after authenticated hydration, and again on focus, reconnect, visibility return, an explicit flush request and a bounded interval.
- Back, task close and navigation remain immediate. The global worker owns background delivery and cannot reopen a closed task or restore an older whole-task snapshot.
- Records are isolated by the signed-in actor. Another account cannot submit or clear a different administrator's queued finance edits.
- The queue never silently evicts unsynced records. If durable storage is unavailable or its high safety limit is reached, the write fails visibly and the interface refuses to show the green safe-to-close state.
- Persistent-storage permission is requested where supported as an additional best-effort protection against browser storage eviction.

## User-visible status

A global finance-sync indicator is shown to administrators:

- **Green — All payment changes synced / Safe to close:** no local mutation is pending and no finance request is in flight.
- **Amber — payment updates syncing:** drafts are already secured on the device and are being delivered sequentially. The user may continue working or navigate elsewhere.
- **Red — updates need attention:** the drafts remain stored, but a validation, version or network problem requires retry/review.
- **Red — payment draft storage needs attention:** the browser did not accept durable storage for the newest draft. The user is explicitly told to keep the website open and retry; green is suppressed until durable storage succeeds.

The task-level ledger status uses the same language: Queued safely, Syncing now, Synced, or Needs attention.

## Thirty-payment close/reopen scenario

For 30 different payment records:

1. Each edit is persisted locally immediately.
2. Confirmed backend writes remain permanent.
3. Unsent or unconfirmed writes remain in the mirrored outbox if the browser closes normally.
4. On reopening and signing in as the same administrator, the queue resumes sequentially.
5. A request that committed just before closure is retried with the same mutation ID and is not duplicated.
6. The green indicator appears only after all 30 records have backend confirmation and the queue is empty.

## Limits that no browser application can eliminate

This protects normal tab/browser closure, browser restart and temporary network loss. It cannot recover browser data that the user manually clears, storage removed by private/incognito-session destruction, device loss, disk failure or an operating-system/browser action that deletes site storage. When storage itself is unavailable, the application shows a red warning and does not claim it is safe to close.

## Deployment scope

`scripts/deploy-monthly-performance-only-vps.sh` is frontend-only for this release. It runs only the targeted finance/monthly frontend tests, installs frontend build dependencies in an isolated stage, builds the UI and atomically replaces `frontend/dist`. It does not run the full release matrix, touch PostgreSQL, run migrations, install backend dependencies or restart PM2.
