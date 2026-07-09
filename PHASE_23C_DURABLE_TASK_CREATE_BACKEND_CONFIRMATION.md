# Phase 23C — Durable Task Create Backend Confirmation

## Problem
Tasks could appear immediately after creation and then disappear later when a delayed backend/localStorage sync replaced the local task list with an older server snapshot. The 30–60 minute delay indicated a sync/cache source-of-truth race, not a Create Task button problem.

## Fix
- Added a dedicated backend project upsert endpoint: `POST /api/state/projects`.
- Create Task now saves the new task to the dedicated endpoint instead of relying only on a full `/api/state` save.
- Added a durable frontend create outbox: `kalpa_pending_created_projects`.
- Newly created tasks are protected from backend/localStorage overwrite until the backend confirms them.
- Pending tasks are retried every 30 seconds, on browser focus, and when the browser comes online.
- Once the backend returns the task, the pending protection is removed.
- Deleted-task memory no longer filters out protected new tasks.
- Recent-created protection was extended from 15 minutes to 2 hours.

## Validation
- Frontend build passed from `frontend/`.
- Backend syntax check passed.

## Notes
Root `npm install` may try to download Electron for desktop packaging. For web frontend validation, use `cd frontend && npm install && npm run build`.
