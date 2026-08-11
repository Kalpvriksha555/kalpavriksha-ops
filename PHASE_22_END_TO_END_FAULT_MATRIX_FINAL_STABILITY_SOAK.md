# Phase 22 — End-to-End Fault Matrix & Final Stability Soak

Date: 2026-08-11

Phase 22 is the final planned source-stability phase after the Phase 21 resume-aware deployment closure. It does not replace the real dependency-installed build, production PostgreSQL backup/integrity checks or guarded live cutover. Its purpose is to combine the failure boundaries introduced in Phases 10–21 and prove that they remain compatible when exercised together for sustained deterministic fault sequences.

## Concrete defect found during the Phase 22 package round-trip

The Phase 21 source workspace contained the required safe `backend/.env.example`, but the delivered Phase 21 ZIP omitted that hidden file. The omission was real: extracting the ZIP and running the backend regression suite failed at `tests/backend/package-environment-example.test.mjs` with `ENOENT` for `backend/.env.example`.

This was a packaging/completeness defect rather than a production-secret problem. The production environment remains external under `/etc/kalpavriksha/backend.env`, but the clean source package must contain the safe template because local setup, clean-package tests and deployment documentation depend on it.

Phase 22 restores the exact reviewed safe template and makes this class of omission fail closed:

- `scripts/doctor.mjs` now requires `backend/.env.example`.
- the Phase 22 verifier requires every mandatory dotfile (`.gitattributes`, `.gitignore`, `.npmrc`, `backend/.env.example`);
- `RELEASE_FILE_MANIFEST.sha256` must cover the complete distributable source tree exactly, not just a subset;
- every manifest entry is SHA-256 rechecked by the Phase 22 gate;
- required hidden files must explicitly appear in the manifest;
- the final ZIP is round-trip compared against the workspace file list before presentation.

A future ZIP tool or packaging step that silently drops a required hidden file therefore cannot produce a certified candidate.

## Cross-phase deterministic fault soak

The permanent Phase 22 gate exercises 25,000 combined iterations without external services. The same loop stresses multiple state machines together rather than one feature at a time:

- workspace responses alternate between fresh, stale and locally-invalidated reads; accepted revision markers must remain monotonic;
- compact finance updates include deliberate older responses; confirmed finance metadata must survive and finance versions must never move backward;
- presence commands are monotonically sequenced while duplicate/out-of-order commands are checked in focused tests;
- a full normal workday of attendance beats accrues normally while a subsequent multi-hour suspended gap is ignored;
- ambiguous PostgreSQL COMMIT acknowledgement succeeds only when independent state version and SHA-256 evidence match exactly;
- foreground persistence failure stays critical/read-only even when a verified shadow exists, while deferred presence telemetry may use that verified shadow temporarily;
- runtime diagnostics retain request correlation while stripping raw IDs/query values and backend 5xx responses never expose internal exception text.

Focused frontend/backend tests add adversarial coverage around malformed persisted shapes, stale reads after local mutation, compact finance deltas, obsolete presence epochs, diagnostic whitelisting and source-package environment completeness.

## Permanent release integration

- `npm run verify:fault-soak` runs `scripts/phase-22-end-to-end-fault-soak-check.mjs`.
- root `npm run verify` runs Phase 22 immediately after the Phase 21 deployment gate.
- `scripts/full-release-verifier-matrix.mjs` includes `end-to-end-fault-matrix-final-soak`.
- current deployment version proofs are updated to `1.9.30-end-to-end-fault-matrix-final-stability-soak` / `2.9.30-end-to-end-fault-matrix-final-stability-soak`.

## Safety boundary

Phase 22 does not bulk-rewrite production data and does not weaken any previous fail-closed rule. Finance history remains append-only/protected, ordinary uploaded-file retention remains separate from financial retention, stale browser responses remain discardable, and a database whose durable outcome cannot be proven still blocks foreground business writes.
