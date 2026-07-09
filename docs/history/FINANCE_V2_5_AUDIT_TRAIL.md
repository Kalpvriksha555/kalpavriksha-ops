# Finance v2.5 – Payment Audit Trail

## Scope
Finance-only audit trail update.

## Added
- Payment status changes now append a `paymentAuditTrail` entry on the related case.
- Backend inline payment endpoint records old status, new status, old amount, new amount, updated by, and note.
- Finance page now has an Admin Audit tab showing payment/ledger activity.
- Audit tab respects current finance filters and does not alter Archive or Operations filtering.

## Not touched
- Archive case filtering
- Operations case filtering
- My Tasks logic
- Command Centre logic
- Upload/download
- Revision workflow

## Verification
- Root build passed.
- Backend syntax check passed.
