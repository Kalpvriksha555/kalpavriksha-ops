# Kalpavriksha 1.9.30 case/upload and isolated-candidate verification

Date: 2026-08-08
Release family: `1.9.30-runtime-persistence-recovery`

## Production symptoms closed

Two related failures were observed on new tasks:

- creation could remain only optimistic in the browser while the backend write was delayed or rejected;
- `Add Source File` could then reach 100% and return `The target task was not found.`

A second edge case was found during the final pre-deployment audit: if the optimistic task ID collides with an existing committed task, a stale upload ID must never win over the original create mutation identity, otherwise a fallback upload could theoretically attach to the older collided task.

## Repair

- Task-detail uploads force pending create confirmation before bytes are sent.
- Background server-ID replacement updates an already-open task detail.
- Source, working, completed, revision/discussion and payment-receipt uploads use the canonical confirmed task.
- Upload requests carry the originating task mutation ID as a recovery identity.
- Backend upload target resolution now prefers the committed `lastTaskMutationId` before a stale optimistic ID when that mutation identity is supplied.
- Files are registered and linked using the canonical immutable server task ID.
- Structured upload errors retain backend code, HTTP status and payload.
- If the task cannot be confirmed, file bytes are not sent.
- Production deployment is blocked unless the exact commit first passes isolated VPS candidate certification.

## Isolated candidate certification

The candidate verifier takes a transaction-consistent read-only snapshot of the live PostgreSQL database and restores it into a disposable local database. Against that production-sized clone it starts the candidate backend on a loopback port with a temporary private-file root, bootstraps a disposable administrator, creates two test cases with an intentional ID collision, replays the create mutation, uploads a real 4 MiB PDF using the stale optimistic ID plus the canonical create mutation, proves the file is linked only to the correct canonical case, downloads it again, and requires exact SHA-256 equality. It also enforces bounded server-side create/upload/download latency and scans the candidate backend log for relational-shadow and target-resolution failures.

The live database is never written by the candidate verifier; the live frontend, live private-file root, live source tree and PM2 process are untouched.

## Source-level verification before packaging

- Frontend tests: 147/147 passed.
- Backend tests: 213/213 passed.
- Combined tests: 360/360 passed.
- Focused candidate/pre-upload/deployment-gate tests: passed.
- Security package audit: passed.
- Project doctor: passed.
- Regression guard: passed.
- Production regression audit: passed.
- Database source verifier: 16 relational tables verified.
- Frontend UX verifier: passed.
- Frontend/backend contract: 72/72 checks across 84 backend routes.
- TypeScript parser sweep: 188 JS/JSX/MJS/CJS files, 0 parse errors.
- Native Node syntax: 174 JS/MJS/CJS files, 0 errors.
- Bash syntax: 20 deployment/maintenance scripts, 0 errors.
- Runtime TODO/FIXME/HACK scan: 0 findings.
- Trailing-whitespace scan: 0 findings.
- Comprehensive source manifest: 360/360 entries verified before packaging.

The dependency-backed React/Vite runtime bootstrap, complete `npm run verify`, clean-install build, production-sized disposable PostgreSQL E2E workflow, and measured latency are intentionally rerun on the VPS candidate before the production launcher is permitted to execute.
