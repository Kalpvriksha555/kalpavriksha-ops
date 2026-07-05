# Finance v2.7 - Admin Payment Reminders

## Scope
Finance-only enhancement. No Archive, Operations, My Tasks, Command Centre, case lifecycle, revision, upload/download, or backend data logic was changed.

## Added
- Admin Finance page now includes a Payment Reminders panel.
- Reminder cards show:
  - Not Updated payments
  - Pending / Partially Paid payments
  - Over 7 days
  - Over 15 days
  - Over 30 days
  - Total outstanding amount
- Clicking a reminder filters the Finance ledger view only.
- Reminder logic is calculated from existing ledger/case payment data.

## Files Modified
- `src/App.jsx`

## Verification
- Root build passed with `npm run build`.
- Backend syntax check passed with `node --check backend/src/server.js`.

## Notes
- Reminder filters do not affect Archive or Operations visibility.
- Managers and designers still have no finance access because this feature is inside the admin Finance/Ledger view only.
