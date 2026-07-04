# Team Availability Since Restore Fix

Restored Team Availability timing labels correctly:

- Admins shown as `Available` only.
- Managers/designers shown as `Free since ...` when available.
- Managers/designers shown as `Drafting since ...` when actively drafting.
- Break users continue to show `Break since ...`.
- Offline users continue to show last seen time.

This corrects the previous patch that hid the `Free since` line for every available user.
