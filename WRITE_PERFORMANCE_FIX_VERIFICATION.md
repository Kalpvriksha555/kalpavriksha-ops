# Write Performance and Upload Backpressure Verification

Release: `1.9.10-write-performance-backpressure`

## Corrected failure chain

- Browser presence heartbeats could overlap every 25 seconds.
- Every heartbeat cloned and persisted the complete operational state.
- Every persistence wrote all relational collections and a complete restore snapshot.
- Multiple users therefore kept the single persistence queue permanently occupied.
- Task creation and file upload requests waited behind background heartbeat writes, so the interface remained on **Creating task** or **Uploading**.
- The new-task form also attempted to upload source files before the task existed on the server.

## Implemented controls

- Presence heartbeats are memory-only in the request path and are durably coalesced.
- Foreground writes always take priority over background presence flushes.
- Browser heartbeat, workspace refresh, and pending-create retries cannot overlap.
- Hidden tabs stop heartbeat traffic and visible tabs use a 60-second interval.
- Task create/update writes only the changed case and audit rows.
- File upload writes only the newly created file row and does not rewrite legacy file rows.
- Partial-write integrity metadata is calculated from the actual committed PostgreSQL state.
- Routine heartbeat and file-upload writes do not create oversized full-state revision snapshots.
- New tasks are created before source files are uploaded and attached.
- Task saves and post-upload processing have finite two-minute response deadlines.
- Reliability diagnostics expose persistence queue depth, active writes, duration, reason, and pending presence state.

## Verification completed

- 48 backend/frontend Node tests passed.
- Backend server syntax check passed.
- PostgreSQL repository syntax check passed.
- Frontend task/file service syntax checks passed.
- Regression guard passed.
- Production regression audit passed.
- Phase 9 frontend/UX verification passed.
- ZIP integrity verification passed after packaging.

## Build note

A complete Vite production build could not be executed in the isolated repair environment because its incomplete `node_modules` directory did not contain Vite and external package retrieval was unavailable. Deployment commands perform a clean dependency installation and production build on the VPS. The changed JSX was also covered by the project frontend/UX and regression source audits.

## Data safety

This hotfix contains no data migration, merge, deletion, credential reset, finance recovery, or July 30 recovery action. Existing PostgreSQL records and uploaded file objects are not altered during deployment. Only subsequent write scheduling and persistence behavior changes.
