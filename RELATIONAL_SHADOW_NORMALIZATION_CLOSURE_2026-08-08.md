# Kalpavriksha 1.9.30 — Relational Shadow Normalization Closure

## Production evidence that closed the diagnosis

The production relational integrity audit at state version 651 was healthy: the stored and calculated snapshot hashes both equalled `e1974a9c20091a6d5ad93883715a445d0dbd92cbab79b3e2f23778e8cd8a65bb`, and all entity counts matched, including 1,842 file rows and 417 performance rows.

A production-locale disposable clone then passed the raw relational startup-integrity check but failed on the first selective write (`bootstrap_admin_create`) with `RELATIONAL_SHADOW_HASH_DIVERGENCE` for `files` and `performanceRecords`. This separated the remaining application defect from the earlier certification-environment failures.

## Root cause

`loadRelationalState()` and `reloadRelationalState()` verified a physical PostgreSQL snapshot and then passed that same `persistedState` object into the server's mutating runtime normalizer.

The runtime normalizer intentionally derives convenience state:

- `normalizePersistedFileLinks()` discovers embedded task/chat documents and adds missing registry entries to `state.files`;
- `mergePerformanceRecords()` derives performance records from cases.

Those derived runtime additions are valid for the in-memory UI/API view, but they are not necessarily physical rows in `ops_files` or `ops_performance_records`. Because normalization mutated the exact object later frozen as `relationalShadowState`, the in-process shadow no longer represented the verified PostgreSQL snapshot. The next selective write compared that normalized shadow to physical metadata and correctly failed closed.

The same defect also existed in `reloadRelationalState()`, so a recovery reload could recreate the divergent shadow.

## Permanent correction

`backend/src/repositories/postgresStateRepository.js` now exposes `normalizeRuntimeStateFromPersistedState()` and normalizes a `structuredClone()` of every verified persisted snapshot.

Therefore:

- `persistedState` remains the exact verified physical PostgreSQL state;
- `state` is a separate runtime-normalized view;
- the frozen `relationalShadowState` stays count/hash aligned with `app_state_metadata`;
- file-registry and performance derivation can continue for runtime behavior without contaminating the persistence guard;
- cold load, concurrent-cutover load and runtime reload all use the same separation rule;
- legacy `app_state` input is also cloned before normalization so legacy credential candidates are not mutated as a side effect of state normalization.

No production data, hash, state version, file row or performance row needs to be rewritten for this correction.

## Certification-environment closure retained

The integrated VPS certifier now also discovers the production PostgreSQL locale provider and ICU locale and initializes its temporary PostgreSQL cluster with the same ICU locale instead of `--no-locale`. It proves the temporary and newly-created disposable databases inherit the production provider/locale before copying production relational rows.

This prevents the disposable certification database from changing tie-break ordering for duplicate `sort_order` values in collections such as files, payments and audit events.

## Regression coverage

Dedicated regression coverage proves that a deliberately mutating runtime normalizer can add derived file/performance records without changing the verified persisted snapshot, its counts or its canonical hash. Deployment-entrypoint tests also require the cold-load/reload clone boundary and production-equivalent ICU certification locale.

Production cutover remains gated behind the existing isolated candidate E2E: real task creation, forced optimistic-ID collision, idempotent replay, 4 MiB upload using the stale optimistic ID plus mutation identity, correct canonical attachment proof, byte-identical download, and forbidden runtime-error scan.
