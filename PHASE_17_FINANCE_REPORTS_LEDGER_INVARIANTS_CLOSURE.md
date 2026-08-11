# Phase 17 — Finance, Reports & Ledger Invariants Closure

Date: 2026-08-10

## Scope

Phase 17 continues the stability-closure programme from the Phase 16 attendance/presence baseline. It is intentionally limited to finance correctness, payment/ledger concurrency, monthly-report ownership and durable finance audit invariants. Unchanged dependency-install, database-certification, backup and deployment phases are not repeated here.

## Defects closed

### 1. Finance freshness could be defeated by a later client clock

The old merge policy mixed `financeVersion` and timestamps in one freshness value. A stale browser record with a lower finance version but a later local clock could therefore replace a newer committed finance state.

`financeVersion` is now the authoritative concurrency clock on both backend and frontend. Timestamps are used only when versions are equal or legacy rows have no meaningful version.

### 2. Compact finance responses could erase fields they did not contain

The finance merge helpers previously treated absence as deletion. A compact state delta that changed only the amount could therefore drop unrelated transaction IDs, receipt metadata, audit data or other finance fields.

Backend and frontend merges now update only finance properties actually present in the selected source. Explicit null/empty values can still intentionally overwrite a field; omission cannot.

### 3. Response-loss retry history remembered only one mutation

Only `lastFinanceMutationId` was retained. If mutation A committed but its response was lost, then mutation B committed, a delayed retry of A could no longer be proven idempotent.

Cases now retain a bounded committed finance mutation receipt history. Each receipt stores the mutation ID, operation, payload fingerprint, committed finance version, payment ID and commit time. The history is bounded to prevent unbounded case growth.

### 4. A mutation ID was not cryptographically bound to its business payload

Finance mutation IDs are now SHA-256 fingerprinted against their canonical business payload and operation. Retry-only metadata such as expected version and mutation ID itself is excluded. Reusing a committed ID for different payment content or a different finance operation fails closed with `FINANCE_MUTATION_ID_REUSE`.

### 5. An identical retry could race the original PostgreSQL commit

The process exposes queued writes in memory so later requests see current state, while PostgreSQL commits remain serialized. An exact retry arriving while the original mutation was still in that queue could previously encounter a false finance-version conflict.

The replay resolver now checks durable committed state first. If the exact same mutation is visible only as a pending write, it captures and waits for the persistence queue that already existed at that moment, then rechecks committed state. Uncommitted memory state is never returned as a successful idempotent replay.

### 6. Legacy payment-ledger route had weaker invariants

`POST /api/cases/:id/payment` now uses the same committed mutation replay/fingerprint contract as the canonical payment-status endpoint. It also validates exact `YYYY-MM-DD` payment dates, rejects future payment dates, rejects refunds greater than the received amount and requires a positive amount when payment is marked received.

### 7. Browser finance outbox could become stuck after a real version conflict

A same-content network/response-loss retry still correctly reuses the same mutation ID and expected version. However, after a terminal `FINANCE_VERSION_CONFLICT` or mutation-ID conflict and a newer authoritative finance version is loaded, re-entering the same values now creates a new intentional mutation instead of remaining trapped behind the stale mutation identity.

Late confirmations also advance `expectedFinanceVersion` and `confirmedFinanceVersion` monotonically, so an older response cannot move a newer queued draft backwards.

### 8. App and task-service merge paths could disagree

Both `taskService.js` and `App.jsx` now use the same `applyFreshestTaskFinance` helper. `estimateAmount` is explicitly part of the finance merge field set, and both paths preserve compact-patch semantics.

### 9. Relational finance-only classification did not know the new mutation metadata

The PostgreSQL operational drift/finance classifier now treats the Phase 17 mutation fingerprint, operation and bounded receipt history as finance-only case fields. This prevents legitimate finance-only writes from being misclassified merely because the new idempotency metadata changed.

### 10. Monthly reports remain bound to the task operational month

The existing accounting policy remains enforced: a later payment entry or correction updates the task's original operational finance month rather than silently moving historical work into the entry month. Existing monthly-report tests remain part of the full regression suite.

## Permanent safety gates

Phase 17 adds `scripts/phase-17-finance-ledger-invariants-check.mjs` and registers it as `npm run verify:finance-ledger`. It is wired into both the normal verification chain and the full release-verifier matrix.

The gate checks version-first merge ordering, compact-patch preservation, fingerprinted bounded mutation receipts, committed-state replay, legacy-route parity, monotonic browser outbox versions, common frontend finance merge use, task-month report ownership and append-only PostgreSQL `finance_history` behavior.

## Data-retention invariant

Phase 17 does not add any destructive finance cleanup. PostgreSQL finance history remains append-only in application repository code, and the existing permanent protection for finance/payment/bank-ledger evidence remains unchanged.
