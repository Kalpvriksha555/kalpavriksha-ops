# Clean Release Verification Results

Validated from the automatic-payment-ledger baseline on 2 August 2026.

## Passed

- ZIP/source packaging audit
- JSON parsing and package-lock consistency
- JavaScript syntax across scripts, backend, tests and services
- JSX parsing for the modified frontend entry point and Command Centre
- Bash syntax across deployment scripts
- Security package audit
- Project doctor
- Regression guard
- Production regression audit
- 74 frontend tests
- 135 backend tests
- 209 combined tests
- Phase 5 relational schema/integrity verification across 16 tables
- Phase 9 frontend/UX verification
- 74 frontend/backend contract checks across 83 backend routes
- Exact calendar-month Performance Analytics and leaderboard scope
- Reversible Admin-only Manager/Designer score baselines
- Corrected monthly report creation cohort and carried-forward completions
- Selected-row physical PostgreSQL verification before integrity metadata commit

## Production integrity handling

The guarded repair accepts only three non-destructive evidence classes:

1. Canonical-hash-preserving count metadata drift limited to approved collections.
2. The documented legacy normalized-shadow condition limited to `files` and `performanceRecords` where stored counts exceed physical counts.
3. Equal-count operational hash drift proven against a recent independently valid revision and limited to live presence, current-day attendance, append-only audit, or narrowly verified finance-only case/payment edits.

Every repair requires a recent verified full PostgreSQL/private-files backup, runs while writes are stopped, changes no operational rows, creates a new canonical revision, records an operational event, and then requires strict integrity to pass. Any unsupported difference remains blocked.

## Environment limitation

A clean `npm ci` could not be completed in the packaging environment because its internal npm mirror returned HTTP 404 for public packages. Package-lock consistency and all source-level checks passed. The VPS deployment performs an isolated clean installation and production build before downtime.
