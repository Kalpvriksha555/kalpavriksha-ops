# Revision Work Queue Fix

Implemented a safer revision workflow:

- A revision created from a completed/archive case now creates a temporary active revision work item for today.
- The temporary revision ID uses `OriginalTaskId-R#` only while revision work is active.
- Today's Operations shows the revision immediately with a clear Revision R# badge.
- The assigned user's My Tasks receives the revision automatically.
- The original archived task remains completed and keeps its permanent original task ID.
- When a revision is approved/completed, it is merged back into the original task history and the temporary revision work item is removed from Archive visibility.
- Archive hides temporary revision work items and shows revision history count on the original case.

Build check: `npm run build` passed.
