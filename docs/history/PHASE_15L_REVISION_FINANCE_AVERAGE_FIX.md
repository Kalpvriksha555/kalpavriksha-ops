# Phase 15L — Revision Finance + Real Average Timing Fix

## Fixed

- Revision work items are now operational-only and no longer create duplicate ledger/payment rows.
- Revision work items preserve the original task ID as the display/business ID.
- Finance ledger excludes revision work items from pending payment calculations.
- Average completion engine now supports Firestore Timestamp objects and serialized timestamp objects.
- Timeline parsing now uses the same robust timestamp parser as task fields.
- Average completion now falls back to completed-file upload timestamps and broad lifecycle timestamps for legacy records.
- Case-type productivity now uses the same fixed timing engine.

## Validation

- Frontend build passed.
- Backend syntax check passed.
