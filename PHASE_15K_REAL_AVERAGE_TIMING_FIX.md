# Phase 15K — Real Average Timing Fix

Implemented a stronger average-time engine for Performance Analytics.

## Fixed

- Avg Completion no longer depends only on ideal timestamp fields.
- Uses real workflow timestamps when available:
  - draftingStartedAt / workStartedAt / startedAt
  - completedAt / approvedAt / submittedAt / deliveredAt
- Uses completed uploaded files/documents as completion end time when task-level timestamps are missing.
- Uses timeline/history/activity events as fallback.
- Uses created/assigned time as safe fallback for older completed cases.
- Break minutes are still deducted from completion duration.
- Case-type productivity uses the same timing engine.

## Validation

- Frontend build passed.
- Backend syntax check passed.
