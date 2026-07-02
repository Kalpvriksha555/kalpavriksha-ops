# Command Centre Interactive Dashboard v2

Implemented dashboard-level click actions for Command Centre KPI and workflow cards.

## Added
- KPI cards now act as filters.
- Cases Received filters daily received cases.
- Active Pending filters incomplete active cases.
- Completion Rate filters completed cases for the selected date.
- Delayed SLA filters overdue cases.
- Near SLA filters upcoming SLA-risk cases.
- Urgent Revisions filters revision cases.
- Operations Flow stage cards are clickable.
- Active Workload availability cards scroll to Team Availability and apply the relevant member filter.
- Daily Operations Board shows the current filter label and matching record count.
- Clear filter control restores the full active operations list.

## Safety
- No backend logic changed.
- No task mutation logic changed.
- No chat, attendance, file, auth, or theme logic changed.
