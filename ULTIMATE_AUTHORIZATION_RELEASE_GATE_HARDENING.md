# Ultimate Authorization and Release-Gate Hardening

## Incident confirmed from the VPS release log

The complete source and unit suites passed, followed by Phase 2 finance and
Phase 3 authentication verification. Phase 4 then stopped at its cross-Designer
anti-spoofing probe.

The failure was not a successful unauthorized task edit. The dedicated task
route checked `expectedTaskVersion` before checking whether the authenticated
Designer owned the task. Because the verifier intentionally omitted a version
for an unauthorized task, the server returned an optimistic-concurrency
response instead of the authorization response the security probe required.

## Backend correction

Both existing-task write paths now enforce this order:

1. Resolve the authenticated server-side session.
2. Reject a caller who cannot mutate the task with
   `403 TASK_UPDATE_FORBIDDEN`.
3. Only for an authorized caller, validate `expectedTaskVersion`.
4. Apply lifecycle, field-protection, finance-preservation and persistence
   rules.

This order is enforced in:

- `POST /api/state/projects`
- Legacy compatibility writes through `POST /api/state`

Client-supplied role headers and body fields remain ignored.

## Verifier correction

The Phase 4 anti-spoofing probe deliberately continues to omit
`expectedTaskVersion`. It now checks both the HTTP status and exact error code
for the dedicated task route and the legacy broad-state route. This proves that
authorization takes precedence and that no task-version information is leaked
to an unrelated user.

All legitimate existing-task edits in the verifier continue to carry the
current optimistic task version.

## Deployment hardening

The VPS deployment script now:

- Performs a source-order audit for both task-write routes.
- Verifies both Phase 4 anti-spoofing probes are present.
- Syntax-checks every backend, verifier and test JavaScript file.
- Validates the production environment before stopping PM2.
- Prints an explicit guarantee when a pre-deployment check fails that the live
  backend was not stopped and production data was not modified.
- Retains the existing clean-install, full verification, backup, migration,
  relational-integrity, release-certificate, rollback and health gates.

## Verification completed in the packaged source

- Security package audit: PASS
- Project doctor: PASS
- Regression guard: PASS
- Production regression audit: PASS
- Frontend source/unit tests: 72 PASS
- Backend source/unit tests: 115 PASS
- Targeted lifecycle and authorization tests: 16 PASS
- Phase 5 relational integrity verifier: PASS
- Phase 8 release-certificate and recovery verifier: PASS
- Phase 9 frontend/UX verifier: PASS
- Frontend/backend contract checks: 72 PASS across 81 backend routes
- All backend, verifier, test and deployment-script syntax checks: PASS
- Authorization-precedence source audit: PASS

The dependency-backed runtime verifiers and production build are intentionally
rerun by the isolated VPS staging script before any downtime. The package
cannot bypass those checks.
