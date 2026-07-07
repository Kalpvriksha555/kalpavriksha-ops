# Attendance Engine V3 Single-Source Flicker Fix

## Actual issue found
The Attendance screen was still flickering because two independent state streams were painting the same rows:

1. `/api/state` polling every 30 seconds
2. `/api/presence` heartbeat responses every 25 seconds

On top of that, Firebase snapshot listeners could still run in backend mode and overwrite backend attendance/presence data. The app was also POSTing `users` back through `/api/state`, creating a second presence writer.

This caused the UI to alternate between two valid but different snapshots, which looked like the page was switching between two displays.

## Fix applied
- Backend mode now disables Firebase snapshot readers.
- `/api/state` save payload no longer posts `users` back to the server.
- `/api/presence` heartbeat is now a writer-only operation.
- Attendance UI is painted only from `/api/state`.
- Heartbeat loop no longer mutates local `users` directly.
- Non-heartbeat actions such as login, break, resume, and logout can still update promptly.

## Result
Attendance Engine V3 now has one display reader and one presence writer, preventing slow alternating flicker between two snapshots.
