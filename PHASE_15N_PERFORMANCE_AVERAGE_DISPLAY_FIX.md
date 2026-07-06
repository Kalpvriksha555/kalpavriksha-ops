# Phase 15N - Performance Average Display Fix

- Added legacy baseline fallback for completed tasks that do not have clean lifecycle timestamps.
- Avg Completion now shows for older completed records instead of remaining blank.
- Case-type productivity uses the same fallback engine.
- Avg Review now shows a conservative review baseline for completed legacy cases where review events were not recorded.
- Real timestamp-based calculations remain preferred whenever data exists.
- New timed records will gradually improve/degrade the overall average over time.
