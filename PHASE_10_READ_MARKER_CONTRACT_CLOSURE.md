# Phase 10 — Read-Marker Contract Closure

This stability phase addresses the user-specific evening crash captured as `((intermediate value) || []).some is not a function`.

## Root cause closed
The frontend treated `notification.readBy` as an array, while the backend notification read endpoints persisted it as a scalar user name string. A truthy string bypasses `|| []`, so `.some()` was invoked on a non-array. The defect could appear only for some users after a notification/read action, which matches the observed intermittent per-user behavior.

## Changes
- Legacy scalar/object notification `readBy` values are normalized to arrays at frontend utility boundaries.
- Chat read markers receive the same defensive normalization.
- App notification and chat render/update paths no longer call array methods on unchecked `readBy` values.
- Backend now creates notifications with `readBy: []` and appends actor-specific read marker objects instead of overwriting the field with a string.
- Existing legacy scalar notification rows are normalized in API responses without requiring a risky database rewrite.
- `read-all` is actor-specific instead of relying on a shared `status === READ` bit for role-wide notifications.
- Focused frontend/backend regression tests lock the contract.

## Deployment intent
Incremental only: this phase changes runtime source/tests and does not require a database migration or destructive data operation.
