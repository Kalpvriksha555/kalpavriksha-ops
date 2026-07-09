# Task Edit Duplication & Discussion Restore Fix

## Fixed

1. Editing a task no longer leaves the old task behind when the task ID changes.
   - The previous task ID is marked as superseded/deleted.
   - The old browser/local record is filtered out immediately.
   - The old Firebase project document is deleted when cloud sync is active.
   - The old backend project record is deleted when backend state sync is active.
   - Existing duplicated records are also hidden if a newer task contains `previousTaskIds`.

2. Task discussion is restored.
   - Operation list/kanban Chat buttons now open the global group chat with the task ID prefilled.
   - Task details now include a `Discuss in Group Chat` button.
   - Chat receives the full project list so task references like `#KNP-AB-NISH-0001` can resolve back to the task.
   - Clicking task references in chat can reopen the related task.

## Validation

- Frontend build passed.
- Backend syntax check passed.
- No Archive/Operations filtering logic was changed beyond duplicate/superseded task cleanup.
