# Kalpvriksha Designs Ops — Expanded Hardening Roadmap

The audit has been expanded into nine controlled phases so security, persistence and UI changes can be verified independently.

## Phase 1 — Emergency package and secret cleanup — Completed

Sanitised the source package, removed private runtime data and secrets, blocked unsafe production JSON fallback, and restored reproducible source packaging.

## Phase 2 — Finance durability and anti-rollback protection — Completed

Adds awaited transactional persistence, state/finance versions, stale-write conflicts, dedicated finance saves, append-only finance history and restart verification.

## Phase 3 — Backend authentication and session security — Completed

Backend login, versioned scrypt password hashing, Secure/HTTP-only sessions, CSRF protection, session rotation/revocation, login lockout, account restrictions, recovery OTP and forced password replacement for migrated staff.

## Phase 4 — Server-enforced authorisation and API protection — Completed

Central role/capability enforcement, session-derived actor identity, task/finance/file/chat/notification scoping, private direct messages, strict CORS, CSRF, request IDs, rate limits, unsafe-payload rejection and bounded uploads.

## Phase 5 — Relational database and migration integrity — Completed

Core operational collections now persist in dedicated PostgreSQL tables with transactional synchronisation, optimistic state versions, ordered collection preservation, checksummed migrations, integrity hashes, append-only state revisions, automatic one-time import from `app_state`, health diagnostics and guarded revision restoration. The legacy row is retained only as an untouched emergency migration source.

## Phase 6 — File storage, upload and privacy hardening — Completed

Private persistent content-addressed storage, extension/signature validation, SHA-256 checksums, deduplication, authenticated record-level access, quarantine, optional ClamAV integration, recoverable deletion, legacy import, orphan/missing reconciliation and PostgreSQL audit tables.

## Phase 7 — Reliability, backup, monitoring and recovery — Completed

Atomic verified PostgreSQL/private-file backups, checksum manifests, restore drills, liveness/readiness probes, structured redacted logs, graceful shutdown, disk/backup-age alerts, operational event history and failed-job visibility.

## Phase 8 — Automated test and release certification — Completed

Clean-install isolation, frontend unit tests, all prior API/runtime regression suites, source-hashed expiring release certificates, production configuration and backup gates, PostgreSQL certification records, and transaction-safe selective finance recovery with dry-run planning and immutable receipts.

## Phase 9 — Frontend architecture, performance and UX completion — Completed

Removed the Firebase SDK from production dependencies, added route-level code splitting, extracted inline runtime CSS, introduced adaptive visibility-aware workspace synchronisation, replaced browser-blocking dialogs, added accessibility safeguards, and implemented grouped/collapsible location-based archive navigation with mobile cards and finance summaries.

## Finance recovery after phase completion

After all nine phases, before the repaired baseline is deployed, preserve the current live database and recover only missing finance fields from a July 28/29 backup or other verified source. Do not restore an old full database over current tasks and archive records.
