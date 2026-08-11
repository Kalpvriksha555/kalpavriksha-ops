# Phase 18 — PostgreSQL Runtime Persistence & Restart Closure

Date: 2026-08-10

## Scope

Phase 18 continues from the Phase 17 finance/ledger baseline and is intentionally limited to the PostgreSQL relational-state boundary, ambiguous transaction outcomes, runtime recovery, persistence-queue ownership, revision restore and graceful process shutdown. Unchanged frontend feature work, dependency installation, production backup certification and live cutover are not repeated in this source-only phase.

## Defects closed

### 1. Metadata and physical rows could be read from different committed versions

`loadRelationalState()`, `reloadRelationalState()` and relational health previously performed important reads in ordinary autocommit mode. During deployment overlap or runtime recovery, another process could commit after metadata was read but before physical rows were read. The application could then compare metadata from version N with rows from version N+1 and report a false relational integrity failure even though PostgreSQL itself was healthy.

Existing relational startup, runtime reload and health verification now read metadata and physical rows inside one `REPEATABLE READ READ ONLY` transaction. Hash/count verification therefore describes one PostgreSQL MVCC snapshot.

The one-time legacy import path also re-verifies the exact relational state while holding its advisory lock if another process completed the import first.

### 2. A successful COMMIT could be reported as a failed write after socket loss

A PostgreSQL transaction can reach durable COMMIT while the client connection fails before Node receives the acknowledgement. Previously this ambiguous outcome propagated as a normal persistence error, so a browser could retry a mutation that was already durable.

Immediately before COMMIT the repository now captures exact immutable evidence:

- target state version;
- canonical snapshot SHA-256;
- entity counts.

If COMMIT acknowledgement becomes ambiguous, a new independent PostgreSQL connection opens a repeatable-read transaction and proves the exact metadata version/hash plus the physically reconstructed relational snapshot. Only an exact match is accepted as committed. Otherwise the original failure remains a failure.

The server has an additional reconciliation boundary for cases where the repository could not perform its own confirmation but a subsequent relational reload proves the same exact version/hash.

### 3. Foreground persistence failure could leave an uncommitted optimistic state visible

The previous verified-shadow fallback was limited to deferred/presence persistence. If a foreground business mutation failed and PostgreSQL reload also failed, the in-memory optimistic state could remain present while runtime maintenance still allowed safe/read-only GET requests.

The last physically verified relational shadow is now restored after any persistence failure when it is available. For a foreground failure this shadow is read-only continuity only: the persistence failure remains critical and writes stay blocked until PostgreSQL itself can be reloaded successfully. A shadow fallback is considered fully recovered only for deferred telemetry/presence writes.

### 4. Runtime reconnect could reset live bookkeeping through `initStore()`

Runtime recovery previously reused the cold-start initializer. That could reinitialize workspace revision bookkeeping and interfere with unsaved presence-generation tracking while the process was already serving a verified read-only shadow.

Runtime recovery now:

1. waits until foreground writes, queued persistence and in-flight persistence are all drained;
2. reconnects PostgreSQL;
3. reloads one verified committed relational snapshot;
4. preserves newer unsaved presence rows so their normal deferred retry can continue.

Cold startup still uses `initStore()` and legacy credential migration. Runtime recovery no longer does.

### 5. Recovery reload could temporarily leave runtime memory behind later queued commits

A recovery reload can publish an earlier committed version while writes that were already queued before the failure are still finishing. Each later successful queued PostgreSQL commit now republishes its verified committed state whenever the runtime version is behind that commit. After the queue drains, runtime memory therefore catches back up to the durable database rather than remaining stuck on the recovery snapshot.

### 6. Revision restore inherited the same ambiguous-COMMIT risk

Administrative revision restore calls the relational repository directly rather than the normal `save()` wrapper. It now also reconciles an ambiguous COMMIT only when a fresh verified reload proves the exact version/hash evidence. Otherwise restore fails closed.

### 7. Relational health checked counts without proving the full hash

The health path now reconstructs the complete relational state inside the same consistent read transaction and checks both entity counts and the canonical snapshot hash against metadata. A count-only match can no longer be treated as full integrity proof.

### 8. PM2 could force-kill the backend before its graceful persistence drain finished

The backend supports a graceful shutdown window of up to 120 seconds so it can stop intake, flush deferred presence, await the persistence queue and close PostgreSQL in order. The production deployment launcher now starts the rollback, staging and permanent PM2 processes with an explicit 125,000 ms kill timeout and validates that the configured value cannot be shorter than that safety floor.

This setting protects subsequent PM2 stop/restart operations after the Phase 18 runtime has been started. The release still relies on the existing pre-deployment backup/database gates for the first cutover from an older PM2 process configuration.

## Permanent safety gate

Phase 18 adds `scripts/phase-18-runtime-persistence-restart-check.mjs` and registers it as `npm run verify:persistence-restart` immediately after the Phase 17 finance gate.

It is also part of the full release-verifier matrix. The gate permanently requires:

- repeatable-read relational load/reload/health boundaries;
- exact ambiguous-COMMIT evidence and independent physical verification;
- foreground fail-closed verified-shadow behavior;
- drained runtime recovery without `initStore()` reset;
- runtime catch-up as later queued commits finish;
- graceful shutdown ordering;
- explicit PM2 kill-timeout protection on every current start path;
- focused Phase 18 regression coverage.

## Data-safety invariant

Phase 18 introduces no bulk data rewrite, destructive repair or automatic finance deletion. When persistence outcome cannot be proven, the application prefers the last verified committed relational shadow and blocks new foreground writes rather than exposing uncertain optimistic business state.
