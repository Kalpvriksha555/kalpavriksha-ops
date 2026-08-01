# Task Date and Finance Period Verification

## Verified behaviour

- New task date defaults to the current India calendar date.
- Admins and Managers can choose a valid earlier date.
- Invalid dates and future dates fail closed.
- The selected task date is stored independently from the actual entry timestamp.
- A task's finance month is derived from its immutable task date/creation date.
- A July task updated in August changes July Finance and does not create August finance activity.
- Late corrections replace the task-month total, including legacy records whose first audit event is unavailable.
- The actual payment date and audit timestamp remain available for traceability.
- New-workload reports use the effective task date; completion and revision reports use their actual event dates.
- Malformed legacy finance values cannot render `NaN` totals.

## Automated verification

- Backend and frontend tests: 104/104 passed.
- Security package audit: passed.
- Project doctor: passed.
- Regression guard: passed.
- Production regression audit: passed.
- Frontend/UX verification: passed.
- JavaScript syntax validation: passed.
- JSX/TSX parser validation: passed.
- Relative source-import resolution: passed.
- Duplicate route and duplicate test-name checks: passed.
- Package/lockfile consistency: passed.
- Conflict-marker and runtime-artifact scans: passed.
- Monthly finance benchmark: 10,000 records processed in approximately 103 ms in the repair environment.
- ZIP integrity and file-by-file hash comparison: passed.

## Deployment-host gates

The repair environment does not contain the project's installed npm dependencies. A clean `npm ci`, Vite production build, dependency-backed backend startup, and PostgreSQL integration verification must therefore pass on the deployment host before PM2 is restarted.
