# Phase 24E.5 – Performance & Regression Guardrails

## Scope
This phase does not add features or change business workflows. It adds low-risk guardrails that reduce future regressions and fixes one overlay performance issue discovered in the shared UI layer.

## Changes

### Portal scroll-lock safety
- `PortalLayer` now supports an explicit `lockScroll` prop.
- Dialogs/previews still lock background scrolling by default.
- Non-blocking portal UI, such as toast notifications, no longer locks body scrolling.
- This prevents notification toasts from causing hidden scroll/layout side effects.

### Regression guard script
Added:

```bash
npm run guard
```

The guard checks:
- exactly one active `frontend/src/App.jsx`
- no unexpected duplicate source folders outside active frontend/backend paths
- one Create Task portal path
- one file preview portal path
- PortalLayer scroll-lock control exists
- Toast notifications do not lock body scroll
- risky direct task list replacements are surfaced as warnings
- remaining browser `alert()` usage is surfaced as warnings

### Verify script strengthened
`npm run verify` now runs:

```bash
npm run doctor && npm run guard && npm run build
```

## Validation
- Frontend build passed.
- Backend syntax check passed.
- Project doctor passed.
- Regression guard passed.

## Notes
The guard currently allows warnings for remaining legacy browser `alert()` calls. Those will be gradually replaced in future UI consolidation phases to avoid broad risky rewrites.
