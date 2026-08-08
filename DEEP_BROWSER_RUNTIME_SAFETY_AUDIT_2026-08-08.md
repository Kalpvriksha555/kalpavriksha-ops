# Kalpavriksha 1.9.30 Deep Browser & Runtime Safety Audit

Release: `1.9.30-runtime-persistence-recovery`
Backend/frontend: `2.9.30-runtime-persistence-recovery`
Audit date: 08 Aug 2026

## Why this audit was required

The previous 1.9.30 deployment passed its source, unit, build, database, release and health gates, but the real browser still entered the application error boundary on the signed-out first render with:

`Cannot read properties of null (reading 'id')`

The exact cause was an explicit `null` identity reaching helpers whose parameters defaulted to `{}`. JavaScript default parameters apply to `undefined`, not to an explicitly supplied `null`, so a source-only test could pass while the actual React render still crashed. This audit treats that as a verifier-coverage defect as well as an application defect.

## Deep fixes

### 1. Browser bootstrap and null-shape safety

- Closed the signed-out `currentUser === null` bootstrap crash.
- Hardened browser identity, role, finance, notification, task, archive, attendance, profile, chat, file and reporting helpers against explicit null records.
- Systematically converted direct property reads of frontend parameters that default to `{}` into null-safe reads. The final AST audit reports **0 unresolved direct property dereferences** in this class, including nested callbacks.
- Normalized public collection/component boundaries so malformed non-array `projects`, `users`, `attendanceLogs`, attachments and persisted cache shapes are rejected or converted to safe empty collections instead of entering render loops.
- Removed direct mutation of `currentUser.lastMentionRead` / `currentUser.lastChatRead`; chat read cursors now live in component refs.
- Hardened local/session storage hydration against valid JSON with the wrong shape, not only invalid JSON syntax.

### 2. Real React runtime bootstrap gate

Added `scripts/frontend-runtime-bootstrap-check.mjs` and wired it into both `npm run verify` and the full release verifier matrix. After dependencies are installed it:

- loads the real `frontend/src/App.jsx` through Vite SSR;
- renders the signed-out `App` through ReactDOMServer;
- fails if the initial render is empty, falls into the fatal error boundary, contains null/undefined property crashes, or does not produce an authentication surface.

During this deep audit the verifier itself exposed a Node 22 compatibility issue: `globalThis.navigator` is getter-backed and cannot safely be overwritten with `Object.assign`. The verifier was corrected to install browser stubs using configurable `Object.defineProperty` calls. It now reaches dependency loading correctly in the local audit environment.

### 3. Runtime diagnostics

The main application error boundary now records bounded component-stack diagnostics, and global `window.error` plus `unhandledrejection` events are captured into a bounded local diagnostic log. Only error metadata is stored; operational workspace records are not included. This improves future root-cause evidence without changing server data.

### 4. Backend/data safety

- Authorization inputs fail closed for null/malformed users, cases, notifications and file documents.
- Authentication/public-session helpers normalize nullable credential/user structures.
- Timeline, reliability, release-recovery and file-storage boundaries normalize explicit null safely.
- Relational persistence now throws the controlled code `RELATIONAL_STATE_INVALID` for a null root or malformed collection shape instead of accidentally treating bad structural state as empty data or leaking incidental JavaScript `TypeError`s.
- Relational recomposition filters null row payloads and validates row-array / misc-map shapes before building the runtime state.

### 5. Release hygiene

- Removed all trailing whitespace found by the audit, including the formatting issues that previously made `git diff --cached --check` noisy.
- The current deployment documentation explicitly lists the signed-out React bootstrap and production frontend build as pre-cutover gates.

## Verification completed in this audit environment

- Frontend tests: **144/144 passed**.
- Backend tests: **208/208 passed**.
- Combined automated tests: **352/352 passed**.
- Security package audit: **passed**.
- Project doctor: **passed**.
- Regression guard: **passed**.
- Production regression audit: **passed**.
- Database source verifier: **passed**, 16 relational tables verified.
- Frontend UX verifier: **passed**.
- Frontend/backend contract: **72/72 checks passed across 84 backend routes**.
- TypeScript parser syntax sweep: **187 JS/JSX/MJS/CJS files, 0 parse errors**.
- Native Node syntax sweep: **171 JS/MJS/CJS files, 0 errors**.
- Bash syntax sweep: **19 scripts, 0 errors**.
- Runtime TODO/FIXME/HACK marker scan: **0 markers** in frontend/backend/scripts runtime code.
- Frontend default-object null-safety AST scan: **0 unresolved direct dereferences**.
- AppShell top-level pre-auth render scan: **0 direct `currentUser.*` dereferences before the signed-out return guard**.
- Trailing-whitespace scan: **0 issues**.

## Dependency-backed verification limitation in this environment

This workspace intentionally contains no `node_modules`. The local package mirror available to this environment has previously returned 404s for required npm packages, so a clean dependency install and Vite production build cannot be repeated here. The new React runtime bootstrap verifier now progresses correctly until it reaches `import('vite')`, where it fails only because Vite is not installed locally.

The Phase 8 source verifier therefore reports `runtimeReadinessCertificateGate: false` locally by design: it runs that runtime portion only when `backend/node_modules/dotenv` exists, or fails if `PHASE8_REQUIRE_RUNTIME=true`.

This is not treated as production confirmation. The 1.9.30 guarded VPS deployer performs clean dependency installs first and then runs `npm run verify`; because the new signed-out runtime gate is now inside that command, the next deployment must execute the real React bootstrap and production build successfully before any cutover is accepted.

## Production acceptance rule

Do not describe the release as proven error-free merely from source tests. Production acceptance requires this exact packaged source to pass, on the VPS:

1. clean root/backend/frontend dependency installs;
2. the complete `npm run verify` chain including signed-out React runtime bootstrap and production build;
3. PostgreSQL integrity and release-certificate checks;
4. verified pre-deployment backup;
5. staged liveness/readiness;
6. atomic cutover and permanent liveness/readiness;
7. verified post-deployment backup; and
8. real-browser smoke tests for sign-in, case creation, initial attachment upload, final-file upload, preview/download, logout and refresh.

This closes the known browser-bootstrap failure class and materially broadens runtime/data-shape protection, while keeping the deployment fail-closed if the dependency-backed runtime or production browser path reveals another defect.
