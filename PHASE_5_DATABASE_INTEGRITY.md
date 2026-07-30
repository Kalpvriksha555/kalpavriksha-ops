# Phase 5 — Relational Database and Migration Integrity

## Objective

Remove the single mutable `app_state` JSON row as the production source of truth without breaking the existing application or risking a destructive first migration.

## Authoritative PostgreSQL model

Phase 5 introduces dedicated tables for:

- users
- cases/tasks
- payments
- notifications
- team chat
- attendance logs
- audit events
- performance records
- WhatsApp inbox entries
- file metadata
- deletion tombstones
- chat read state
- miscellaneous top-level settings

Each record retains its complete legacy payload in JSONB for compatibility while important searchable fields are promoted into indexed relational columns. Array ordering is stored explicitly so the reconstructed application state is byte-equivalent under canonical hashing.

## Safe legacy import

On the first startup after deployment:

1. Checksummed migrations are applied under a PostgreSQL advisory lock.
2. If `app_state_metadata` does not exist, the existing `app_state.main` record is read.
3. The state is normalised and written to the dedicated tables in one transaction.
4. Counts and a SHA-256 canonical snapshot hash are recorded.
5. The original `app_state` row is not deleted or modified.
6. All later reads and writes use the relational tables.

If no legacy row exists, the same process creates an empty secure seed.

## Concurrency and integrity

- Every mutation locks `app_state_metadata.main` and verifies the expected state version.
- A stale request receives `STATE_VERSION_CONFLICT` rather than overwriting newer work.
- All domain-table updates, finance history, authentication operations, state revision and metadata changes commit together.
- Startup checks reconstructed entity counts and the state hash.
- A mismatch raises `RELATIONAL_STATE_INTEGRITY_FAILURE` and blocks startup.
- Applied migration SQL is protected by SHA-256 checksums. Editing an already-applied migration raises `MIGRATION_CHECKSUM_MISMATCH`.
- New payment, file and WhatsApp rows must reference an existing case after the legacy import. Existing orphan records are preserved for Phase 6 reconciliation rather than causing a destructive migration failure.

## Revision ledger

Each successful PostgreSQL commit creates an append-only `state_revisions` record containing:

- state version
- actor and reason
- entity counts
- canonical snapshot hash
- complete recovery snapshot
- creation timestamp

Retention defaults to 200 revisions and can be changed with `STATE_REVISION_RETENTION` from 25 to 5,000.

Admin-only APIs:

- `GET /api/db/health`
- `GET /api/db/migrations`
- `GET /api/db/revisions`
- `POST /api/db/revisions/:id/restore`

Restoration requires the exact confirmation text `RESTORE <revisionId>`. The restore is saved as a new state version, so history remains forward-only.

## Deployment commands

Before first deployment:

```bash
pg_dump "$DATABASE_URL" -Fc -f "/root/kalpavriksha-before-phase5-$(date +%F-%H%M).dump"
```

Migration and integrity commands:

```bash
cd /var/www/kalpavriksha-ops/backend
npm run db:migrate
npm run db:integrity
```

The API also applies pending migrations automatically at startup. Manual migration is provided for controlled deployment visibility.

## Important recovery rule

Do not restore the old `app_state` row over the relational tables after Phase 5 becomes active. Use a verified `state_revisions` entry or selective field recovery instead. The separate July 28 finance recovery must still be performed only after the live database is backed up.
