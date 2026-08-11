# Phase 13 — Task Lifecycle & Mutation/Idempotency Closure

Date: 2026-08-10
Baseline: Phase 12 API Contract & Stale-Response Closure

## Objective

Close task-specific failure modes that can appear only after retries, response loss, stale tabs, double submits, cross-tab edits, or secondary-store mirroring. The authoritative production database remains PostgreSQL; browser and legacy cloud state must not be allowed to override or preserve a task mutation that PostgreSQL rejected.

## Concrete defects closed

### 1. Mutation-ID replay was not bound to the original task payload
The main task write route used `lastTaskMutationId` to recognize a retry, but a reused mutation ID was not cryptographically bound to the operation and payload that originally committed it. A client bug could therefore make a different edit look like a replay.

Phase 13 canonicalizes task mutation payloads, stores a SHA-256 fingerprint and operation beside every committed mutation ID, and fails closed with `TASK_MUTATION_ID_REUSE` when one ID is reused for a different change. Legacy rows without a stored fingerprint remain replay-compatible.

### 2. Dedicated lifecycle routes could duplicate side effects after response loss
Assignment, start, manager completion, revision opening and manual timeline routes did not share the main task route's optimistic version/idempotency contract. Retrying after a successful-but-lost response could add duplicate history/timeline/notifications/revisions.

Phase 13 adds `prepareDedicatedTaskMutation()` and `commitDedicatedTaskMutation()` to these routes. Each route now:

- requires the caller's expected task version once the task is versioned;
- recognizes only an exact mutation replay;
- returns before side effects on replay;
- increments `taskVersion` on a new mutation;
- stores mutation ID, operation, fingerprint and commit time atomically with the task change.

### 3. Stale task deletion could remain hidden locally
The browser optimistically hid a deleted task, but deletion did not carry the exact task version the user had reviewed. A later conflict/permanent failure could leave local delete state active even though PostgreSQL rejected the delete.

Phase 13 captures `expectedTaskVersion` and one stable delete mutation ID, stores them in the actor-scoped delete outbox, and reuses them on every retry. A stale/permanent delete rejection removes the local tombstone, clears the retry group, refreshes the authoritative workspace and restores the task.

### 4. Backend-mode cloud mirroring could preserve rejected task data
Task updates could previously be written to the legacy Firebase/cloud mirror before PostgreSQL accepted them. New-task creation also had a separate direct mirror path that could write the optimistic task even after the immediate backend save failed transiently.

Phase 13 forbids those writes in backend-authoritative mode. Existing-task mirrors now use only the confirmed server task. New-task mirroring requires `projectConfirmedByBackend` before touching the cloud mirror. If a task is confirmed later by the durable retry outbox or by pre-upload server confirmation, only that confirmed server record is mirrored. Confirmed delete mirroring also happens only after the authoritative delete succeeds.

### 5. Retry-outbox version conflicts depended entirely on a successful refresh
A task update retained after a network failure could later receive a permanent/version rejection. The outbox removed the retry and requested a refresh, but if that refresh itself failed the optimistic stale task could remain on screen.

Phase 13 stores the last known server task as `rollbackProject` for retryable updates. A later version/permanent rejection restores that snapshot immediately, before attempting the network refresh. Retryable creates without a previous server task are removed locally if they are later rejected permanently.

### 6. Double-submit protection is now a release invariant
The existing create-task `isSubmittingLead` guard and disabled/loading submit button are now checked by the Phase 13 release gate so future UI changes cannot silently remove the duplicate-click protection.

## Deliberate boundary

Source/final/working/chat file upload idempotency and storage recovery are intentionally left for Phase 14, where multipart transfer, cancellation, duplicate content, preview and retention can be treated as one coherent file lifecycle. Phase 13 does not mix file-storage changes into the task mutation closure.

## Permanent release gate

`scripts/phase-13-task-lifecycle-idempotency-check.mjs` verifies the mutation fingerprint contract, dedicated lifecycle route protection, delete versioning/outbox rollback, authoritative cloud-mirror ordering, pending-update rollback snapshots and create-task double-submit protection.

The gate is wired into both root `npm run verify` and `scripts/full-release-verifier-matrix.mjs`.
