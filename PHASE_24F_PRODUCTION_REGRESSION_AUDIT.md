# Phase 24F – Full Production Regression Audit

## Purpose
This phase adds project-wide verification guardrails without changing business logic or adding features.

## What changed
- Added `scripts/production-regression-audit.mjs`.
- Added `npm run audit:production`.
- Strengthened `npm run verify` so it now runs:
  1. project doctor
  2. regression guard
  3. production regression audit
  4. frontend build

## What the audit checks
- Single active frontend source path.
- No raw `.env` files in the distributable ZIP.
- Create Task still uses the global portal.
- Create Task still routes through centralized task service.
- Fresh/pending tasks remain protected from stale sync overwrite.
- Preview still uses one global portal.
- Preview toolbar retains zoom, fit, and rotate controls.
- Toasts do not lock body scroll.
- Global error boundary exists.
- Backend still exposes safe preview/download behavior.

## Scope safety
No workflow or business rules were intentionally changed in this phase.
