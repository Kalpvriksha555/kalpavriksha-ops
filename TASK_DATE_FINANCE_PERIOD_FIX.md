# Task Date and Finance Period Fix

## Behaviour

- New tasks default to today's date in the India timezone.
- Admins and Managers may choose an earlier task date when a missed entry is being recorded.
- Future task dates are rejected in both the browser and backend.
- The selected task date becomes the task's operational and finance accounting month.
- Payment updates made later remain assigned to the task's original month.
- The actual payment date and update audit timestamp are retained for traceability.
- Reports use the selected task date for new-workload counts and the actual completion date for completion counts.
- Existing tasks without an explicit task date use their stored creation date as the accounting-month source.
- Finance and report totals coerce malformed legacy values to zero instead of rendering `NaN`.

## Data fields

- `taskDate`: effective operational date in `YYYY-MM-DD` format.
- `taskAccountingPeriod`: immutable accounting month in `YYYY-MM` format.
- `createdAt`: effective task creation timestamp.
- `recordedAt`: actual timestamp when the backdated entry was recorded.

The task date is immutable after creation so later edits cannot silently move finance or reporting data between months.
