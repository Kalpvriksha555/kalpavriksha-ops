# Employee Sync Exact Fix

This patch restores the stable App.jsx structure and applies only one real employee-sync fix:

- Removed the hardcoded block that excluded `faraz` from operational team lists.

Why:
- Faraz was being added correctly as a user.
- Team Workload used the raw users list, so Faraz appeared there.
- Attendance, Chat, Availability and other team sections used `getOperationalUsers()`.
- `getOperationalUsers()` filtered out anyone matching `TEAM_ALIASES_TO_BLOCK`, and that list contained `faraz`.

Files included:
- frontend/src/App.jsx
- src/App.jsx

This also reverts the broken Phase 2 canonical-list changes because the files are based on the stable rollback version.
