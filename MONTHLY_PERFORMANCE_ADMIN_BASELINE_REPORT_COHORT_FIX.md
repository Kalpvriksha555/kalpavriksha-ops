# Monthly Performance, Admin Baseline, and Report Cohort Fix

## Performance analytics and leaderboard

- Performance Analytics now opens in **Monthly** mode.
- Administrators and authorised team members can switch between:
  - **Monthly** — one exact calendar month selected with a month picker.
  - **Overall** — all valid performance records after each member's optional score baseline.
- The summary cards, team performance cards, leaderboard table, exports, completion averages, review averages, revision rate, SLA, quality and productivity all follow the same selected scope.
- Monthly completion metrics use explicit completion events. Legacy records that only have an ambiguous `updatedAt` value are excluded from monthly completion totals instead of being assigned to the wrong month.
- The existing aggregate privacy rule remains intact: designers can compare team totals without receiving other members' case details.

## Admin score-baseline switch

- Each Manager and Designer performance card has an Admin-only switch.
- Enabling the switch starts that member's score baseline from the first day of the current month.
- Older testing-period performance records remain in PostgreSQL and the audit trail but are excluded from new overall averages and scores.
- Disabling the switch restores the member's full valid performance history.
- Admin and other non-performance roles cannot receive a score baseline.
- Every change is an authorised, versioned, audited relational write affecting only the selected user and the new audit row.

## Monthly reports correction

- **New Workload** is the selected month's creation cohort.
- Headline **Completed** now counts only cases created in the selected month and completed in that same month.
- Older cases completed during the selected month are displayed separately as **Carried-forward completions**.
- Therefore, a month with zero newly registered cases cannot show completed new workload merely because older cases were completed in that month.
- Finance and revision events continue to use their own exact calendar dates.

## Production-integrity deployment safeguard

The latest live database audit had equal physical and metadata row counts but a different canonical hash after ordinary live writes. This release adds an evidence-bounded repair class for that narrow condition.

The repair is allowed only when all of the following are true:

- all physical and metadata entity counts match;
- the source is relational;
- a recent internally verified state revision exists and is within a bounded version/time window;
- the revision snapshot hash and counts validate independently;
- no task insertion/deletion or unrelated task field has changed;
- no notification, chat, file, performance-record, deletion, chat-read or miscellaneous collection has changed;
- user changes are limited to live-presence fields;
- attendance changes are limited to the current India calendar day without identity changes;
- audit history is append-only;
- any case/payment changes are narrowly validated finance-only edits linked to the same case.

A recent verified full PostgreSQL and private-files backup is still mandatory before repair. The repair changes no operational rows; it creates a new canonical revision and updates integrity metadata. Any unsupported difference fails closed.

Selected relational writes now also read their exact rows back from PostgreSQL before committing integrity metadata. A payload, sort-order, or deletion mismatch rolls back the transaction.

## Verification

- 74 frontend tests passed.
- 134 backend tests passed.
- 208 total source tests passed.
- Security package audit passed.
- Project doctor passed.
- Regression guard passed.
- Production regression audit passed.
- Phase 5 relational schema/integrity verification passed across 16 tables.
- Phase 9 frontend/UX verification passed.
- 74 frontend/backend contract checks passed across 83 backend routes.
- JavaScript, JSX and deployment-shell syntax checks passed.
