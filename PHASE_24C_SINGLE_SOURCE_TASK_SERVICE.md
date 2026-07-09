# Phase 24C – Single Source Task Service Foundation

## Scope
Stabilization only. No new product feature was added.

## What changed
- Added centralized task API helpers in `frontend/src/services/taskService.js`.
- Added shared task normalization, freshness, merge, and local-cache persistence helpers.
- Routed backend state hydration through `fetchBackendState`.
- Routed backend task creation through `createTaskApi`.
- Routed backend task deletion through `deleteTaskApi`.
- Routed backend state saving through `saveBackendStateApi`.
- Updated local task persistence to use the service-backed cache helper.
- Existing UI modules continue to work from the same task state while the service layer becomes the stable foundation for future cleanup.

## Why
The project had many task-state paths. This phase starts consolidating them behind one service so backend refresh, local cache, cross-tab sync, create, delete, and pending-create retries do not fight each other.

## Validation
- Frontend build passed.
- Backend syntax check passed.
- Project doctor passed.

## Next recommended phase
Phase 24D should continue service consolidation by moving update/assignment/completion/revision mutations behind the same task service one by one.
