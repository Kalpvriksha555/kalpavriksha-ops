# Phase 17G - Performance Average Final Fix

Fixed the remaining Team Performance Card average issue.

## What changed
- Backend now backfills legacy performance rows that have completed history but no saved duration fields.
- Lifetime Avg, Last 30, Last 10, Avg Review, Speed, and Case-Type Productivity now use safe timing fallbacks.
- Existing historical records no longer appear as `-` just because old rows lack explicit `totalCompletionMinutes`.
- Users with no actual history still show no rating instead of fabricated performance.
- Frontend now normalizes incoming backend records and calculates missing timing from timestamps or conservative case-type baselines.
- Patched both root `src/` and `frontend/src/` copies so either deployment path gets the fix.

## Verification
- Root frontend build passed with `npm run build`.
- Backend syntax check passed with `node --check backend/src/server.js`.
- Local `/api/state` test returned performance timing:
  - performance records with timing: 13/13
  - invalid durations: 0
  - team average completion: 88 minutes
