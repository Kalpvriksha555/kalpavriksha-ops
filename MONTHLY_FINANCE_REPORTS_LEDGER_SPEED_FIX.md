# Monthly Finance, Reports, and Payment Ledger Stability Fix

## Accounting-period separation

- Finance defaults to the current India calendar month and every card, row, summary, audit view, report, and CSV export is scoped to the selected `YYYY-MM` accounting period.
- Payments, expenses, and refunds are calculated from immutable audit movements. A later-month update does not rewrite an earlier month's received, expense, refund, pending-at-close, or status-at-close values.
- Previous-month outstanding amounts are displayed only in a labelled carry-forward notice and are excluded from the selected month's totals.
- Historical payment aging is calculated as of that month's close, not as of the present day.
- Reports use separate created, completed, revision, and finance event dates. They no longer use rolling 30/90-day windows or mix prior-month events into the selected month.

## Payment ledger performance

- Monthly finance entries are cached per task and period during a render.
- Derived task rows, filters, totals, carry-forward, and client/customer summaries are memoized.
- Audit history is built only when the Audit tab is opened.
- Multi-month summaries are built only when the Month Summary tab is opened.
- Transaction, pending, report, and audit tables render at most 50 rows per page.
- Payment updates persist only the changed case, audit row, and changed payment row.
- Payment-update responses return only the changed payment record instead of resending the entire payment ledger.
- Deterministic audit identifiers prevent unnecessary row replacement during React reconciliation.

## Deployment gates

Before PM2 is restarted, deployment must stop on any failure from clean dependency installation, production frontend build, backend startup/readiness, PostgreSQL integrity checks, and application test suites. The July 30 recovery/final-merge script must not be rerun.
