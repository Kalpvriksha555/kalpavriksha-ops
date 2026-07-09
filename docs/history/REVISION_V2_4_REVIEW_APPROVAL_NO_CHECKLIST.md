# Revision v2.4 – Review & Approval Workflow (No Checklist)

Scope implemented without adding the checklist step requested to be excluded.

## Added
- Revision internal-review state handling for temporary revision work items.
- Review comments through **Request Changes** while a revision is in Internal Review.
- Revision can be sent back to the assigned designer as **Changes Requested**.
- Revision approval button label now shows **Approve Revision** for revision work items.
- Revision workflow panel in task detail with current state and latest review comments.
- Revision timeline now includes review, approval, and change-request events.
- Revision approval remains linked back to the original permanent task ID.
- Command Centre revision metrics:
  - Awaiting Review
  - Changes Requested
  - Approved Today
  - Average Revision Time
  - Oldest Review Pending
- Revision-specific notifications for review pending, changes requested, and approval.

## Not changed
- No review checklist was added.
- Archive filtering untouched.
- Operations filtering untouched.
- Finance/Ledger untouched.
- Payment workflow untouched.
- Task ID generation untouched.
- Completed-case archive logic untouched.

## Verification
- Frontend production build passed.
- Backend syntax check passed.
