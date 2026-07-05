# Undefined Reference Stability Fix

## Scope
Focused runtime crash fix only.

## Fixed
- Removed misplaced Finance payment status cards from Team Attendance UI that referenced `financePaymentStatuses`, `selectedPaymentStatus`, and `statusCounts` outside the Finance component.
- Moved Revision Timeline derived values into the case detail component scope so `revisionTimelineItems`, `completedRevisionItems`, and `activeRevisionItems` exist before the JSX renders them.

## Not Changed
- Archive filtering
- Operations filtering
- Finance ledger logic
- Case completion logic
- Revision data model
- Backend APIs

## Verification
- Frontend build passed
- Root build passed
- Backend syntax check passed
