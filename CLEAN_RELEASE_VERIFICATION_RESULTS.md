# Clean Release Verification Results

Validated from a fresh extraction of the user-supplied baseline on 2 August 2026.

## Passed

- ZIP/source packaging audit
- JSON parsing and package-lock consistency
- JavaScript syntax across scripts, backend, tests and services
- Bash syntax across deployment scripts
- Security package audit
- Project doctor
- Regression guard
- Production regression audit
- 73 frontend tests
- 129 backend tests
- 202 combined tests
- Phase 5 relational schema/integrity verification across 16 tables
- Phase 9 frontend/UX verification
- 72 frontend/backend contract checks across 82 backend routes
- Missing environment template restored
- Generated frontend build removed
- Obsolete July 30/legacy rollback deployment launchers removed

## Production integrity handling

The guarded repair accepts only the documented legacy normalized-shadow condition where mismatches are limited to `files` and `performanceRecords`, stored counts are greater than physical counts, and the metadata source is relational. It requires a recent verified full PostgreSQL/private-files backup, runs while writes are stopped, changes no operational rows, creates a new canonical revision from physical PostgreSQL rows, updates integrity metadata, records an operational event, and then requires strict integrity to pass.

Any other mismatch remains blocked.

## Environment limitation

A clean `npm ci` could not be completed in the packaging environment because its internal npm mirror returned HTTP 404 for the public package `zod-validation-error@4.0.2`. Package-lock consistency passed, and the VPS deployment performs its own isolated clean install before downtime.
