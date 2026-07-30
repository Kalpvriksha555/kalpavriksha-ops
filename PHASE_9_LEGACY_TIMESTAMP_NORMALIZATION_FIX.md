# Phase 9 Legacy Timestamp Normalization Fix

This hotfix prevents a malformed legacy epoch value from blocking the one-time PostgreSQL relational import.

The production data contained a microsecond epoch value (`1782968923198498`). JavaScript previously treated it as milliseconds and produced the extended-year timestamp `+058470-01-13T09:19:58.498Z`, which PostgreSQL rejected with error `22009`.

The fix:

- recognizes epoch values expressed in seconds, milliseconds, microseconds, or nanoseconds;
- converts them to bounded operational milliseconds before generating an ISO timestamp;
- rejects impossible or out-of-range dates without throwing;
- applies the same normalization to case freshness and timeline calculations;
- includes regression tests for the exact production failure.

The legacy JSON payload is preserved. Only typed relational timestamp columns are normalized, so no operational or finance fields are discarded.
