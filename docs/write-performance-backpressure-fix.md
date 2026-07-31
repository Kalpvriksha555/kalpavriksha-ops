# Write Performance and Upload Backpressure Fix

## Root cause

The production backend persisted the complete operational state for every 25-second user heartbeat. Each persistence transaction scanned all relational collections and wrote a complete state revision. With multiple signed-in users and the recovered production dataset, heartbeat requests could arrive faster than the persistence queue completed. Task creation and file-upload requests then waited behind that queue, leaving the frontend on “Creating task” or “Uploading…” even after the request body reached the server.

The frontend also allowed a new heartbeat, workspace refresh, or pending-task retry to start while the previous request of the same type was still running. During a slow period this amplified the queue.

## Correction

- Presence heartbeats update only the small in-memory users/attendance slice.
- Heartbeats are coalesced into one durable write every three minutes, or included in the next ordinary business write.
- Background heartbeat persistence waits for task/file writes and never takes foreground queue priority.
- Routine presence and file-upload persistence do not create oversized full-state restore revisions. Business task revisions remain available.
- Task create/update operations write only the changed case and audit rows. File uploads write only the new file row, so historical orphan rows are preserved without being rewritten. Partial writes rebuild the actual committed PostgreSQL view before updating integrity metadata, preventing false corruption failures after restart.
- Heartbeat, workspace refresh, and pending-task retry requests cannot overlap in the browser.
- New tasks are persisted before their source files are uploaded, eliminating the old `CASE_NOT_FOUND` ordering defect.
- Task saves and post-upload server processing now have finite two-minute response deadlines instead of leaving the interface spinning indefinitely.
- Hidden browser tabs stop sending heartbeat traffic; visible tabs use a 60-second interval.
- Reliability diagnostics now expose persistence queue depth, active writes, duration, reason, and pending presence state.

## Data safety

No migration rewrites, deletes, merges, or finance recovery actions are included. Existing cases, attendance, finance, files, credentials, and revision history remain intact. The change affects write scheduling and relational synchronization only.
