# Phase 17D — Performance Engine Verification & Rebuild

## Scope

This phase strengthens the Phase 17 analytics foundation by adding a verification and rebuild layer.

## Implemented

- Added backend performance diagnostics endpoint.
- Added backend performance rebuild endpoint.
- Performance summary now calculates overall averages directly from records.
- Frontend Performance Analytics shows engine status.
- Added a manual **Rebuild History** action from Performance Analytics.
- Diagnostics expose completed candidates, generated records, records with timing, missing owners, and revision exclusions.

## Purpose

This prevents future confusion where the UI shows `No data` without knowing whether the issue is missing task history, missing owner mapping, missing timing, or backend records not rebuilt.

## Validation

- Frontend build passes.
- Backend syntax check passes.
