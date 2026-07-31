# Team Transparency and Speed Fix

Release versions:

- Root: `1.9.14-team-transparency-speed`
- Backend: `2.9.14-team-transparency-speed`
- Frontend: `2.9.14-team-transparency-speed`

## Problems confirmed

### Designer leaderboard showed only the signed-in designer

Designer state access is intentionally limited to assigned cases. The Performance Analytics page was building every member's row from that role-scoped case list, so peer rows had no source data and disappeared or displayed incomplete values.

### Unchanged and small updates still caused unnecessary work

The workspace used one global revision. A chat message, notification read, user-profile update, or task update could therefore make the next background refresh resend the complete role-visible project collection. Routine writes also performed full-state normalization, rebuilt derived performance history, and rescanned every persisted file link.

## Corrections

### Aggregate team leaderboard

- Added `GET /api/performance/leaderboard?range=week|month|quarter` for every authenticated role with `performance:read`.
- Returns all approved non-Admin members with aggregate assigned, completed, active, revision, completion-time, SLA, productivity, history, rank, availability, and today-completed values.
- Does not return another designer's case records, customer details, addresses, documents, comments, or file links.
- Resolves ownership by stable assignee ID first and display name second so renamed users do not lose counts.
- Caches historical aggregate calculations by performance revision, range, and India attendance date while merging live presence separately.
- Invalidates historical aggregates for case, performance, membership, role, approval, name, and workload-profile changes, but not for heartbeat-only writes.
- Refreshing the performance engine automatically reloads the selected range's team leaderboard.

### Collection-aware background synchronization

- Added independent revisions for users, cases, deleted-project IDs, team chat, notifications, and attendance.
- The browser sends its last collection revisions during adaptive synchronization.
- Chat-only changes return chat only.
- Notification-only changes return notifications only.
- User-profile changes return users only.
- Case changes return projects and any other genuinely changed collections.
- Presence-only changes keep the small users/attendance response.
- Completely unchanged workspaces keep the minimal `unchanged` response.
- Older clients without collection revisions continue to receive the compatible full response.

### Faster routine writes

- Added selective state normalization for declared relational collections.
- Routine task, file, chat, notification, user, attendance, and finance writes no longer rebuild every historical performance record.
- Routine writes no longer rescan and rewrite every persisted file link.
- Full normalization remains for startup, migration, recovery, and unspecified whole-state operations.
- Performance records continue to be derived from authoritative cases during reads and are persisted canonically by the explicit performance rebuild operation.

## Security and data boundaries

The fix expands comparison visibility, not case visibility. Designers can compare aggregate team performance and live availability, but server-side case and file authorization remains unchanged. Admin and Manager retain their existing operational visibility.

## Deployment requirements

The source package intentionally excludes dependencies, frontend builds, environment files, databases, logs, uploads, and production records. Before PM2 is restarted, the deployment host must successfully complete clean dependency installation, production frontend build, isolated backend verifiers, database readiness, private-storage readiness, and the release gate.
