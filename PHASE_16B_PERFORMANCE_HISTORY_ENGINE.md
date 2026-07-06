# Phase 16B – Performance History Engine

Implemented a stability-focused average calculation pass.

## What changed

- Backend `/api/state` now returns `performanceRecords` as a first-class operational analytics dataset.
- Backend `/api/state` save response also returns updated performance records/counts.
- Frontend keeps `performanceRecords` in app state after hydration and live refresh.
- Performance Analytics now combines backend performance history with locally derived task lifecycle records.
- Added deterministic merging of performance records by task + user, preferring records with real duration/review data.
- Avg Completion, Avg Review, and case-type productivity now read from the same performance record source instead of relying only on current visible task rows.

## Stability principle

The Performance page should not calculate isolated averages from daily rows only. It now uses historical task performance records where available, and generated task-lifecycle records as fallback.

## Build checks

- Frontend build passed.
- Backend syntax check passed.
