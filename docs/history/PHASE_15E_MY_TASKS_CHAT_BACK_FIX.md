# Phase 15E – My Tasks, Discussion Tags & Back Navigation Fix

## Fixed
- Carry-forward assigned tasks remain visible in the assigned user's My Tasks until completion.
- Operations task opening now stores the correct return tab, so Back returns to the page the task was opened from instead of jumping to Archive.
- Task Discussion from inside a task now inserts a proper clickable task tag in group chat.
- If a task is assigned, Task Discussion also tags the assigned user.
- Task references saved in chat messages can still open the case even when the text parser cannot resolve the task from the current lookup.
- User mentions in chat are styled consistently for all users, not only the current user.

## Validation
- Frontend build passed.
- Backend syntax check passed.
