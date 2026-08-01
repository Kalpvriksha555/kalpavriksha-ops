# Phase 4 Authorization Verifier Compatibility Fix

The Phase 4 release verifier was aligned with the current protected API contracts.

- The partial-payment scenario now supplies the explicit ₹9,000 expected amount through the finance endpoint, so a ₹5,000 receipt is correctly verified as `Pending`.
- Existing-task edits now carry the current optimistic `expectedTaskVersion`.
- The manager assignment scenario uses the lifecycle-safe `Assigned` status instead of entering protected review without a completed deliverable.
- The reusable VPS deployment script refuses a GitHub commit that does not contain all Phase 2 and Phase 4 verifier corrections.
- Static regression coverage protects these verifier inputs.

These changes affect release verification only. They do not weaken finance, task-version, authorization, or lifecycle enforcement.
