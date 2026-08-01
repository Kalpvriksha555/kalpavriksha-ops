# Overall Stability and Data Safety Fix

Release: `1.9.24-overall-stability-data-safety`

This release audits failure handling across the frontend, API process, PostgreSQL persistence, local-development fallback storage, uploads, chat, notifications, WhatsApp intake, authentication sessions, and revision recovery.

## Fail-closed backend operation

- PostgreSQL row-lock, statement, idle-transaction, connection, and query deadlines prevent a blocked transaction from wedging the global persistence queue.
- Runtime reloads verify physical relational row counts and the canonical state hash before replacing in-memory state.
- An idle PostgreSQL pool error is logged and handled instead of becoming an uncaught EventEmitter crash.
- Startup database/configuration/integrity failures keep one stable maintenance process online. Operational routes return `503` and accept no writes; health endpoints expose the exact failure.
- Retryable database startup failures are retried without overlapping recovery attempts. Non-retryable integrity failures remain blocked for operator intervention.
- Repeated unhandled promise failures trigger a controlled graceful restart; uncaught exceptions close HTTP, flush queued presence work, wait for persistence, and close the pool.

## Data-loss prevention

- JSON sandbox state and authentication files use write-to-temp, file `fsync`, atomic rename, and directory `fsync`.
- A corrupt local authentication file is preserved and startup is blocked; it is never silently replaced with an empty credential store.
- Failed PostgreSQL writes reload only a count/hash-verified committed snapshot. If verification fails, all later writes are blocked.
- Revision restore requires the exact current state version, refuses to run beside active writes, rechecks after the queue drains, and records a pre-restore safety snapshot before applying history.
- Every successful operational write remains a PostgreSQL transaction with optimistic state/task/finance version checks, integrity metadata, idempotency, and periodic recovery revisions.

## Duplicate prevention

- Chat and notification creates carry stable client mutation IDs and return the previously committed row after a response-loss retry.
- File uploads carry one stable mutation ID across retries. The API checks before and after long file validation and returns the already committed file rather than adding a second registry/task attachment.
- WhatsApp intake accepts a provider message/event ID and returns the existing task when the provider retries the same event.
- Generated task references use the current India calendar year and the highest existing suffix rather than collection length, preventing reuse after deletion.

## Resource and UI stability

- Expired OTP challenges are pruned and the in-memory OTP store is capped.
- Expired/revoked authentication sessions older than 30 days are removed periodically; no task, file, finance, attendance, chat, notification, or audit business data is affected.
- Backup commands print progress, recover only genuinely stale lock files, enforce database/archive/verification deadlines, and remove partial archives after failure so deployments cannot hang silently forever.
- A failure inside one active workspace section is isolated by a keyed feature error boundary so navigation and the surrounding shell remain usable.
- Existing whole-site performance isolation remains active: row-level persistence, compact API patches, adaptive collection/row synchronization, coalesced presence, lazy feature screens, cached analytics, and bounded histories.

## Scope

No automatic cleanup deletes operational business records. Task deletion and revision restore remain explicit, authenticated, version-checked administrative actions.
