# Phase 2 — Finance Durability and Anti-Rollback Protection

## Why this phase was moved ahead

The live website retained current tasks and archive records while finance values reverted to an older snapshot. The previous backend updated memory immediately, started the PostgreSQL write in the background, and returned success before the write completed. A later operational task save could also carry older finance fields and overwrite newer finance data because task freshness and finance freshness used the same timestamp.

Phase 2 makes finance persistence fail-safe before authentication and broader API hardening continue.

## Implemented

- Every state mutation now waits for persistence before returning success.
- PostgreSQL writes run inside a transaction and use a state-version check.
- The API returns HTTP 409 instead of silently overwriting state when a stale state version is detected.
- Finance fields use their own freshness clock and can no longer be replaced by a newer task/status edit carrying older finance data.
- Frontend task merging applies the same finance-specific freshness rules.
- Finance updates use the dedicated `/api/state/projects/:id/payment-status` endpoint before the general task record is saved.
- The frontend accepts a finance update only after the server returns durable-storage confirmation.
- Failed finance saves restore the previous project snapshot instead of leaving an unpersisted value visible.
- Every finance record has an incrementing `financeVersion`.
- Stale finance forms are rejected with `FINANCE_VERSION_CONFLICT`.
- PostgreSQL creates an append-only `finance_history` table containing the previous and next finance snapshots, actor, state version, timestamp and SHA-256 snapshot hash.
- Added Admin finance history and finance health endpoints.
- Invalid `null` payment entries are removed during normalisation so `/api/bootstrap` and ledger summaries cannot crash.
- Full-state payment arrays are merged by payment identity/freshness rather than blindly replacing the server ledger.
- Non-Admin state responses remove all finance fields, including nested ledger data.
- Added an automated restart, stale-overwrite and finance-conflict verification harness.

## New endpoints

- `POST /api/state/projects/:id/payment-status`
- `GET /api/finance/history/:id`
- `GET /api/finance/health`

These endpoints still use the existing temporary role mechanism in this phase. Phase 3 replaces it with authenticated server sessions and server-derived roles.

## Verification command

```powershell
npm run verify:finance
```

The verifier creates a temporary local database, saves a paid finance record, attempts to overwrite it using a newer operational task with stale finance values, confirms the stale data is rejected, restarts the backend, and confirms the paid value still exists.

## Recovery note

This phase prevents future finance rollback. It does not invent or restore the finance values already missing from July 28, 2026. The preserved browser export and live PostgreSQL backup must remain untouched until the later recovery procedure is run from the VPS.
