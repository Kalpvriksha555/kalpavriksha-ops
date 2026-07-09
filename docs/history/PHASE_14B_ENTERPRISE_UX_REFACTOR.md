# Phase 14B — Enterprise UX Refactor

## Purpose
This update implements the intended information architecture cleanup across Command Centre, Team, Performance Analytics and Reports.

## Changes
- Command Centre is now focused on live operations only.
- Live team workload was simplified into live team status/current capacity.
- Removed duplicated performance analytics entry from Command Centre.
- Team page now focuses on people management and live status.
- Team analytics callouts were removed.
- Team member rows now open member profile/live status.
- Performance Analytics is now the single home for employee productivity, rankings, SLA, revision percentage, average completion time and exports.
- Reports is now business-report focused only: operations, banks, branches, finance, payment aging, case types and SLA.
- Employee productivity table removed from Reports.

## Safety
- No backend business logic changes.
- No Operations filtering changes.
- No Archive filtering changes.
- Frontend production build passed.
- Backend syntax check passed.
