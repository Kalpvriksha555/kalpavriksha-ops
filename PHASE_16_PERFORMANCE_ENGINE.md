# Phase 16 — Performance Engine Foundation

Implemented a single-source performance engine foundation so averages are not calculated separately in multiple dashboard widgets.

## What changed

- Added immutable-style performance record generation from completed tasks.
- Added backend `performanceRecords` state support.
- Added `/api/performance-records` endpoint for future backend-driven analytics.
- Frontend Performance Analytics now derives Avg Completion, Avg Review, case-type timing, trend and productivity from generated performance records.
- Revision-only work items are excluded from performance records.
- Completion timing uses a fallback chain:
  1. explicit stored duration fields
  2. draft/start to completion timestamps
  3. assignment/created/completed timestamps
  4. timeline/history events
  5. conservative legacy case-type baseline
- Break minutes are deducted where available.
- Overall historical records are used for average timing instead of daily-only values.

## Why

This keeps performance analytics stable and consistent across dashboards. Future improvements can write real lifecycle timestamps into the performance record table instead of recalculating from raw cases every time.
