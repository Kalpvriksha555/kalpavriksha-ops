# Automatic Finance Background Sync Regression Closure — 2026-08-09

## Scope

This is a frontend-only repair for the payment-ledger regression that reintroduced an explicit **Save Payment Details** action after automatic finance saving had previously been established.

No backend, PostgreSQL, migration, storage-retention, file-preview, authentication, attendance, task-lifecycle or payment-ledger schema code is changed by this repair.

## Restored behaviour

- Payment fields update immediately and remain editable while synchronization runs.
- Every valid edit is written first to the existing actor-scoped durable finance outbox.
- Server synchronization is requested 650 ms after typing stops.
- Leaving a finance field flushes the queued draft immediately.
- Leaving the task also requests a background flush; safely queued finance edits do not block navigation.
- Browser unload warning is reserved for a draft that could not be protected because it is invalid or durable browser storage failed.
- Payment-receipt upload queues and flushes the updated finance draft automatically.
- Reopening the same task restores its newest durable unsynced finance draft.
- If an edit arrives while the previous finance mutation is in flight, the newer mutation remains in the durable outbox and is drained shortly after the earlier confirmation.
- Network/server failures remain durable and retryable through the existing finance outbox; they do not freeze the form.

## UI

The manual save button and the text saying that typing does not write to the server are removed. The ledger instead reports one of:

- `Queued safely • auto-saving…`
- `Syncing in background…`
- `Synced at HH:MM`
- `Needs attention`

## Verification

Source verification for this closure includes:

- automatic status derivation;
- 650 ms debounce;
- field-exit flush;
- durable outbox queue before network flush;
- no manual save button;
- no input disabling during finance synchronization;
- receipt auto-link/flush;
- navigation flush with warning only for unprotected drafts;
- sequential newer-edit drain after an in-flight confirmation;
- existing actor-scoped, mirrored finance-outbox durability tests;
- monthly finance and performance isolation regressions;
- full frontend source regression suite.

Deployment is intentionally frontend-only: backend is not restarted and PostgreSQL is not touched.
