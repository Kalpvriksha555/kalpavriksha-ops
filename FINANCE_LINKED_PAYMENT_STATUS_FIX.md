# Finance-linked Payment Status Fix

Implemented admin-only inline payment controls in Operations and Archive/Task History tables.

## What changed
- Payment status is now changed directly from the table column using a compact dropdown pill.
- Admins can update payment without opening the task detail page.
- When status is changed to **Paid**:
  - The case estimate amount is auto-filled as ledger `amountIn`.
  - Finance ledger `status`, `paymentStatus`, `date`, `updatedAt`, and `updatedBy` are updated.
  - The case automatically appears/updates in Finance Ledger because ledger data is now written immediately.
  - A timeline entry records who marked it paid and the amount added.
- Pending / Not Updated update the payment tracking state without deleting ledger history.
- Managers/designers cannot see or edit the payment control.

## Stability note
Only payment UI/control logic, payment utility logic, and Finance Ledger-connected project update logic were changed.
No case lifecycle, revision, upload/download, archive filtering, or assignment logic was changed.
