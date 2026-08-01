# Kalpavriksha 1.9.24 Ultimate Task Idempotency and Release-Gate Fix

## Root cause
A Manager edit in the Phase 4 verifier echoed the server task object. The API treated the server-owned `lastTaskMutationId` as though it were a new client request ID, classified the genuine edit as an idempotent replay, and returned the unchanged task. The replay check also occurred before authorization, creating a task-existence/data-disclosure risk if an unauthorized caller knew a mutation ID.

## Corrections
- Task mutation IDs are accepted only from explicit client-owned `mutationId` or `clientMutationId` fields.
- `lastTaskMutationId` remains server-owned response/confirmation metadata and is never reused as a new request ID.
- Existing-task authorization now runs before idempotent replay and optimistic task-version validation.
- Unauthorized replay attempts return `403 TASK_UPDATE_FORBIDDEN`.
- The frontend task API and durable retry outbox no longer inherit server-owned mutation metadata.
- Phase 4 now tests unauthorized replay, explicit Manager edits, and a full server-echo edit without an explicit mutation ID.
- The VPS deployment source gate enforces these ownership and ordering rules before dependencies are installed or production is touched.
- A full release-verifier matrix now runs every gate even after an earlier failure, reports all failures together, and aborts before downtime if any gate fails.

## Safety
The deployment still performs all verification, clean-install, backup, migration, database-integrity, release-certification, rollback, and health checks before final cutover.
