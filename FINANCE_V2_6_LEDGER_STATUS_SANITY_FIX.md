# Finance v2.6 - Ledger Status Sanity Fix

Scope: Finance/payment status only.

Fixed:
- Ledger no longer shows `Cleared` when received amount is ₹0.
- `Paid` is valid only when a positive amount received exists.
- If an estimate/payment amount exists but nothing has been received, status becomes `Pending` instead of `Not Updated` or `Cleared`.
- Editing payment ledger fields inside case detail now recalculates the admin payment status automatically.
- Selecting `Paid` from Operations/Archive now requires amount/date/mode input before changing status.
- Backend payment-status endpoint now rejects `Paid` when amount received is missing.

Not touched:
- Archive filtering
- Operations filtering
- Completion status logic
- Assignment logic
- Upload/download
- Revision workflow
- Chat/attendance

Validation:
- `npm run build` passed.
- `node --check backend/src/server.js` passed.
