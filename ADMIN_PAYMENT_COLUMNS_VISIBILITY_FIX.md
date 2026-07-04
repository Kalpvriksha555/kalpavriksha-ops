# Admin Payment Columns Visibility Fix

Fixed why the Payment columns were not visible for the logged-in admin.

Root cause:
- The app stores admin role as `Admin`.
- The new list-column checks were comparing role against `ADMIN`.
- This made the payment columns stay hidden even though the case detail payment ledger was visible.

Changed only:
- `src/components/operations/ActiveOperationsView.jsx`
- `src/components/archive/HistoryArchiveView.jsx`
- `frontend/src/components/operations/ActiveOperationsView.jsx`
- `frontend/src/components/archive/HistoryArchiveView.jsx`

Result:
- Active Operations: admin-only `Payment` column appears beside `Status`.
- Task History Catalog: admin-only `Payment` column appears beside `Designer`.
- Managers/designers do not see the payment column.
- Payment detail ledger remains unchanged.

Build status:
- Root build passed.
- Frontend build passed.
