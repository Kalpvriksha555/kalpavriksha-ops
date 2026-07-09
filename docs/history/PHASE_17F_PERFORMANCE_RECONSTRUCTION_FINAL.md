# Phase 17F – Performance Reconstruction Final Fix

## What was fixed

The average was still showing `-` because existing performance records were being preferred over reconstructed task records even when those existing records had no timing fields.

This phase fixes the root issue:

- Backend now merges performance records intelligently.
- Blank legacy records are enriched with reconstructed timing from completed task data.
- Existing history records are no longer allowed to block generated timing records.
- Root `src` Performance component was aligned with the updated frontend implementation.
- Frontend now combines backend history records with task-derived performance records as a fallback.
- Lifetime Avg, Last 10, Last 30 and case-type timing now have usable timing sources even for legacy completed tasks.

## Important details

For older completed tasks without exact drafting timestamps, the system reconstructs timing using the best available source:

1. Stored effective/total completion minutes.
2. Started/drafting time to completed time.
3. Assigned/created time to completed/upload time.
4. Completed file/document upload timestamps.
5. Timeline/history events.
6. Conservative case-type baseline for very old records.

Future tasks should continue producing better timing because the lifecycle timestamps are now preserved and used by the analytics engine.

## Verification

- Backend syntax check passed.
- Frontend build could not be executed in this sandbox because root `node_modules`/Vite dependencies were not present in the extracted ZIP environment. The changed source files are valid JSX/JS updates based on the existing project structure.
