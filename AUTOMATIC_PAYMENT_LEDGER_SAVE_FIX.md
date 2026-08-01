# Automatic Payment Ledger Save Fix

## User-facing behavior

- Removed the dedicated **Save Payment Details** button.
- Payment fields save automatically 650 ms after typing stops.
- Leaving a field flushes the save immediately.
- Entering only a total estimate automatically calculates and persists **Pending**.
- Entering a received amount equal to or above the estimate automatically calculates and persists **Paid**.
- A partial received amount remains **Pending** while preserving the amount and all payment details.
- Receipt uploads are linked to the ledger automatically.
- The status card shows Waiting, Auto-saving, Saved, or Needs attention.

## Data-safety behavior

- Only one finance request runs at a time.
- Edits made during an active save remain in the draft and are saved next.
- Every payload retains its stable idempotency key.
- A response-loss retry cannot duplicate the finance transaction.
- Invalid amounts, future dates, or refunds above receipts remain visible and are not persisted.
- Navigation flushes the pending automatic save before leaving; discard confirmation appears only if saving fails.

## Deployment false-failure correction

The final deployment check no longer calls the authenticated `/api/db/health` endpoint without credentials. It uses public liveness/readiness endpoints and then runs the authenticated `db:integrity` command, preventing a successful deployment from ending with a misleading HTTP 401.

## Verification

- 73 frontend tests passed.
- 129 backend tests passed.
- 202 total source tests passed.
- Security package audit, project doctor, regression guard and production regression audit passed.
- Phase 9 frontend/UX checks passed.
- 72 frontend/backend contract checks across 82 backend routes passed.
- `App.jsx` JSX syntax and the VPS deployment shell syntax passed.
