# Command Centre Efficiency Polish

Focused update only for Command Centre metrics/status rendering.

## Improved
- Completed cases are now recognised from reliable completion signals, not only the exact `status === Completed` text.
- Revision-pending cases remain active/revision cases even if they already have completed files from an earlier submission.
- Active pending, delayed SLA, near SLA, and workload counts now exclude completed work consistently.
- Operations Flow now separates Pending and Carried Forward for clearer daily workload visibility.
- Completion rate remains capped at 100% and uses a deduplicated base.

## Scope Control
No backend API, archive, upload/download, chat, attendance, or case mutation logic was changed.
