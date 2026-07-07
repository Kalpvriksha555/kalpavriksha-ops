# Attendance Engine V3 Flicker Final Fix

## Actual problem
The Attendance page was still receiving and writing attendance/presence from multiple paths:

1. `/api/presence` heartbeat updates.
2. `/api/state` polling.
3. Local browser attendance timer.
4. Full frontend `/api/state` autosave that included attendance logs.

These sources were racing. One response showed the newer live state; the next response restored an older stale snapshot, so the table kept flickering between two screens.

## Fix applied
- Backend mode now treats `/api/presence` as the only writer for attendance counters.
- Frontend no longer mutates attendance rows locally when backend state is enabled.
- Full `/api/state` autosave no longer posts attendance logs back to the server.
- Frontend merges attendance logs monotonically, preserving the highest valid daily values.
- Frontend merges users using freshness-aware presence logic, so stale offline snapshots cannot erase a newer heartbeat.
- `/api/state` polling now merges attendance instead of replacing it.
- `/api/presence` responses now merge attendance/users instead of replacing the current UI state.

## Expected result
- No more alternating/flickering Live Team Status screens.
- Productive time should not drop from hours to zero.
- Presence should stabilize around heartbeat timeout rules.
- Today’s Insight and Live Team Status use the same V3 rows.
