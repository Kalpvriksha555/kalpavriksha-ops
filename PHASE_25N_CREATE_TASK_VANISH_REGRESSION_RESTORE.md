# Phase 25N - Create Task Vanish Regression Restore

Restores the proven Phase 23C/24B create-task protection behavior after later preview/file refactors.

Fixes:
- Freshly created tasks are protected from stale deleted-id memory.
- `filterDeletedProjects` no longer hides pending/recently-created tasks.
- Create flow clears stale deleted IDs before first merge/persist.
- Backend/cache/poll refresh cannot immediately erase a new case while it is pending confirmation.

Validation:
- Frontend build passed.
- Backend syntax check passed.
