# Case Delete Sync Fix

Focused change only: when an admin deletes a case, it is now treated as a deletion tombstone and cannot reappear from stale Manager/Designer browser state.

- Backend stores `deletedProjectIds`.
- Stale `/api/state` saves are filtered so deleted cases cannot be resurrected.
- Frontend filters deleted cases from local cache, backend state, cross-tab sync, and polling refresh.
- No UI/theme/layout/admin-control changes were made.

Keep your working `.env` unchanged.
