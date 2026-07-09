# Phase 23B - Task Create Sync Lock

Fixed the case disappearing shortly after creation.

Root cause:
- A newly created task could appear locally, then an older backend/tab/cache snapshot refreshed within seconds.
- If the task id had ever existed in the local deleted-id ledger, the refresh filter could also remove it.

Fix:
- Added a short-lived recent-created task protection ledger.
- Backend refresh, tab sync, and autosave now merge protected newly created tasks instead of overwriting them.
- New task IDs are removed from the deleted-id ledger before insertion.
- Local cache now stores the merged protected project list, not only the incoming server snapshot.

Validation:
- Frontend build passed.
- Backend syntax check passed.
