# Finance Inline Payment Phase 1

Implemented the visible admin-only inline payment workflow:

- Active Operations: Payment column now uses an editable dropdown directly in the list/board.
- Task History Catalog: Payment column beside Designer now uses the same editable dropdown.
- Changing payment to Paid auto-fills the finance ledger amount from the case estimate when no received amount already exists.
- Ledger fields updated: amountIn, status, paymentStatus, date, receivedFrom, updatedAt, updatedBy.
- Re-changing the same task does not require opening the task detail page.
- Managers/designers do not see or edit the payment control.

Build checked successfully with Vite.
