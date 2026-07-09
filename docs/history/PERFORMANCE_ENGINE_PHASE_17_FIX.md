# Performance Engine Phase 17 Stability Fix

## What was fixed

- Removed fabricated performance scores for team members with no valid history.
- Users with no timed completed task now show `No Rating Yet` instead of `90/100` or default `100` breakdown values.
- Lifetime Avg, Last 30 Avg, Last 10 Avg, SLA, Revision Rate, Trend, and Score Breakdown now require valid timed history.
- Frontend no longer treats zero-history team members as perfect performers.
- Performance cards now display `-` for missing averages instead of misleading `0m`.
- Score breakdown now shows a clear message until at least one timed task exists.
- Sorting handles unrated users without forcing them above real scored users.

## Backend timing improvements

- Task start now stores both `startedAt` and `draftingStartedAt`.
- Final upload now stores `submittedAt`, `draftingCompletedAt`, and `updatedAt`.
- Manager completion now stores `completedAt`, `reviewedAt`, `reviewCompletedAt`, `finalApprovedAt`, and `updatedAt`.
- Performance case type now correctly reads `serviceType` before fallback values.
- Backend completion duration now prefers real completion/upload timestamps before generic `updatedAt`.

## Verified

- Frontend production build passes.
- Backend syntax check passes.
