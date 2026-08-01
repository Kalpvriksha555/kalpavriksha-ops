# Phase 4 Authorization Verifier Compatibility and Security Fix

The Phase 4 release verifier and backend authorization order are aligned with
the current protected API contracts.

- The partial-payment scenario supplies the explicit ₹9,000 expected amount,
  so a ₹5,000 receipt is correctly verified as `Pending`.
- Every legitimate existing-task edit carries the current optimistic
  `expectedTaskVersion`.
- Cross-Designer spoofing probes intentionally omit `expectedTaskVersion` and
  must receive `403 TASK_UPDATE_FORBIDDEN`.
- The backend now checks authorization before optimistic concurrency in both
  the dedicated task API and the legacy broad-state compatibility API.
- The manager assignment scenario uses lifecycle-safe `Assigned` instead of
  entering protected review without a completed deliverable.
- The reusable VPS deployment script rejects a commit missing any of these
  protections and audits their source ordering before dependency installation.
- Regression coverage protects finance context, task versions, lifecycle
  status, anti-spoofing behavior and authorization precedence.

The change strengthens authorization. It does not weaken finance, task-version,
lifecycle or field-protection enforcement.
