# Assignment Persistence + Availability Fix

This build fixes two requested items:

1. Manager assignment now persists after refresh/logout-login.
   - Assignment is stored in a compact assignment ledger.
   - Older `Unassigned` snapshots cannot overwrite a newer assignment.
   - Local cache, backup cache, and cross-tab sync merge with the ledger.

2. Admins in Team Availability:
   - Admins appear as Available when online.
   - Admins do not show `Free since` timing.
   - Free/Busy/Break timing remains for managers and designers.

Build checked with `npm run build`.
