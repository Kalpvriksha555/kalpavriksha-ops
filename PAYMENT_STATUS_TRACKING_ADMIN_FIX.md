# Payment Status Tracking – Admin Only

Focused update only for admin payment tracking visibility.

## Added
- Admin-only payment status badge on Operations cards/list rows.
- Admin-only payment status badge on Archive rows.
- Admin-only payment status badge on case detail header.
- Admin-only dropdown inside Payment Ledger with:
  - Not Updated
  - Pending
  - Paid

## Behavior
- New/untouched cases show `Not Updated`.
- Admins can update the status from the case detail Payment Ledger.
- Managers/designers do not see the payment status badge or dropdown.
- The change is saved on the task record and synced using the existing project update flow.

## Scope Control
- Did not touch upload/download.
- Did not touch completion/archive logic.
- Did not touch assignment logic.
- Did not touch navigation return logic.
