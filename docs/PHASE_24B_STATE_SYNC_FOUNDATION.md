# Phase 24B – State Sync Foundation Stabilization

Focus: reduce the risk of tasks/cases disappearing after delayed refresh, cross-tab sync, or cache revalidation.

## Changes

- Added one shared frontend project snapshot application path: `applyProjectSnapshot`.
- Backend hydrate, backend polling, pending-create confirmation, and cross-tab sync now use the same merge/protection behavior.
- Freshly created/pending projects remain protected during incoming backend/cache snapshots.
- Firebase/local fallback project refresh now uses the same recent/pending task protection logic.
- Cross-tab sync no longer directly merges with custom ad-hoc logic.
- Fixed corrupted arrow text in task recommendation note.

## Stability intent

Newly created cases should not vanish when:

- backend polling returns an older snapshot,
- another tab broadcasts an older cache,
- localStorage ping triggers a refresh,
- Firebase fallback snapshot is stale,
- immediate create save is delayed and background retry is still pending.

## Validation

- Frontend build passed.
- Backend syntax check passed.
