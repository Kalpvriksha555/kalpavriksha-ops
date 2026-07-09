# Phase 14 — Information Architecture & Navigation Simplification

## Purpose
Performance data had become spread across Command Centre, Team, Reports/Finance, and the dedicated Performance page. This update gives each page a clearer responsibility while preserving the underlying workflows.

## Changes

### Command Centre
- Repositioned as the live operations hub.
- Updated copy to clarify that historical analytics belong in Performance Analytics.
- Renamed performance-style cards to Live Team Workload.
- Replaced the duplicate “Top Today” leaderboard with a clear shortcut to Performance Analytics.

### Performance
- Renamed to Performance Analytics in navigation.
- Repositioned as the single source of truth for productivity, rankings, trends, revisions, workload, and SLA analytics.

### Team
- Repositioned as people management and live team status.
- Removed per-user “View Analytics” entry points that duplicated Performance Analytics.
- Added a single shortcut to Performance Analytics.
- Team table now focuses on availability, current task, completed today, and active workload.

## Stability
- No Operations filtering changes.
- No Archive filtering changes.
- No backend data model changes.
- Frontend build passed.
- Backend syntax check passed.
