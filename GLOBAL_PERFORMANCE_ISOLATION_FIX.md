# Global Performance Isolation Fix

Release: `1.9.21-global-performance-isolation`
Backend/Frontend: `2.9.21-global-performance-isolation`

## Objective

Prevent an action in one workspace option—task, file, payment, chat, notification, profile, attendance, archive, reports, or analytics—from cloning, recalculating, rewriting, downloading, or rerendering unrelated operational data.

## Backend corrections

- Selective PostgreSQL writes now prepare only the changed collection and, where available, only the changed row IDs.
- Explicitly selected rows that disappear from the incoming state are persisted as row-level deletions. Task deletion no longer leaves a hidden relational row or requires a full-table rebuild.
- `deletedProjectIds`, `chatReads`, and miscellaneous state remain on the selective fast path instead of forcing complete state decomposition.
- Unchanged large top-level collections retain their references in the committed relational shadow.
- Canonical integrity hashing caches canonical serialization for unchanged immutable top-level collection references. Startup validation still performs an independent uncached full hash.
- Presence heartbeats track dirty user and current-day attendance row generations and persist only those rows.
- Foreground task/file/payment writes include only the exact unflushed presence rows they cover, avoiding loss and avoiding a complete users/attendance rewrite.
- Chat read and notification read-all actions select only the affected messages and notifications.
- The legacy payment endpoint now returns the same compact finance patch as the primary finance endpoint.
- Routine writes retain periodic full revision snapshots, immutable finance history, optimistic versions, idempotency and the full canonical integrity hash.

## Frontend corrections

- Adaptive workspace synchronisation uses collection revisions and row deltas.
- Simultaneous focus, reconnect and visibility events collapse into one request and at most one queued follow-up.
- Only one adaptive synchronisation timer exists at a time.
- Unchanged task, user, chat, notification and attendance objects retain their references.
- Background changes are applied with `React.startTransition`.
- Production presence uses one server writer; heartbeat responses do not repaint the full application.
- Expensive global views remain memoized and global search is deferred.
- Non-active feature screens remain lazy loaded.
- Production operational state is not repeatedly serialized to browser local storage.

## Data durability retained

The optimisation does not bypass persistence. Successful writes still require a committed PostgreSQL transaction. State versions reject stale updates; mutation IDs prevent duplicate retries; finance history remains append-only; task accounting periods remain immutable; relational hashes detect corruption; and periodic full revisions plus external backups remain available for recovery.
