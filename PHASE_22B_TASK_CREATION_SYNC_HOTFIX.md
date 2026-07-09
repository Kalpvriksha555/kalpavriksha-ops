# Phase 22B - Task Creation Sync Hotfix

Focused fix for task creation regression after Phase 22A.

## Fixed
- New task is inserted into Operations immediately after submit.
- Assigned task appears instantly in the assigned user's My Tasks.
- Assignment data is normalized before saving.
- New task is marked with `showInOperations` and `showInMyTasks` where applicable.
- Assignment ledger is recorded during creation.
- Backend polling no longer overwrites the local merged project list with a stale server-only snapshot.
- Local cache now stores the merged project list, not only the incoming backend list.

## Validation
- Frontend production build passed.
- Backend untouched.
