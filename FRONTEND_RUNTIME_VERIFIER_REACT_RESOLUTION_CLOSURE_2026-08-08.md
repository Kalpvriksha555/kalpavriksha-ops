# Frontend Runtime Verifier React Resolution Closure — 2026-08-08

## Incident

The guarded 1.9.30 deep-runtime candidate correctly stopped before live cutover because `verify:frontend-runtime` failed on the VPS with React's `Invalid hook call` / `Cannot read properties of null (reading 'useState')` inside `FeedbackHost`.

## Root cause

This was a verifier dependency-graph defect, not evidence that `FeedbackHost` violated the Rules of Hooks.

The release intentionally installs root and `frontend/` dependencies separately. The verifier imported `react` and `react-dom/server` from the repository root while Vite SSR loaded `App.jsx` and its component imports from the `frontend/` dependency tree. That mixed two physical React installations in one server-render operation. React hooks from `frontend/node_modules/react` therefore executed under a renderer from root `node_modules/react-dom`, which React correctly rejects as an invalid-hook-call condition.

The VPS stack trace proved the split explicitly: `useState` came from `frontend/node_modules/react/...`, while `renderWithHooks` came from root `node_modules/react-dom/...`.

## Closure

`scripts/frontend-runtime-bootstrap-check.mjs` now:

- resolves `react` and `react-dom/server` through a `createRequire()` anchored at `frontend/package.json`;
- imports both renderer dependencies from the same frontend dependency tree used by the application;
- configures Vite SSR with `resolve.dedupe: ['react', 'react-dom']` so App imports resolve to that same frontend installation;
- reports the resolved React and renderer paths on success and on failure for future diagnostics;
- contains no bare root `import('react')` or `import('react-dom/server')` calls.

The regression suite now asserts these resolver invariants so the verifier cannot silently reintroduce a split React graph.

## Safety consequence

The failed candidate never modified the live frontend, backend, or database. The existing production PM2 backend remained online and liveness returned `ok: true` throughout the incident. The next candidate should be certified in the isolated release directory before launching the live cutover.
