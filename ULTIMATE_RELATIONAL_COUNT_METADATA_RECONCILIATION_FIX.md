# Ultimate Relational Count-Metadata Reconciliation Fix

## Incident resolved

The 21-gate pre-deployment matrix completed successfully, but the first strict production PostgreSQL integrity check after downtime found a `files` row-count mismatch. The physical rows were present and the verified full backup completed successfully. The mismatch was created by the previously running backend generation, which could recalculate `entity_counts` from a normalized relational shadow while retaining the correct canonical snapshot hash.

## Safety model

This release does not weaken integrity verification and does not delete, merge, or rewrite operational rows.

A count-metadata reconciliation is allowed only when all of the following are true:

1. PostgreSQL is under the deployment advisory lock.
2. A recent verified **full** backup contains both the database dump and private-file archive.
3. The canonical hash recomputed from every physical relational row exactly equals the stored `snapshot_hash`.
4. The differences are limited to explicitly approved count-only collections (`files` and legacy `performanceRecords`).
5. The operator supplies the exact confirmation phrase.

The reconciliation updates only `app_state_metadata.entity_counts`, keeps the existing `state_version` and `snapshot_hash`, and records `RELATIONAL_COUNT_METADATA_RECONCILED` in `operational_events` with the before/after counts and backup manifest.

If the canonical hash differs, the deployment stops and the previous runtime is restored. Metadata is never rewritten over actual content corruption.

## Recurrence prevention

Every relational write now reads the physical PostgreSQL counts for the collections touched by that transaction. The calculated committed-state count must equal the physical count before metadata can be committed. A discrepancy raises `RELATIONAL_SHADOW_DIVERGENCE` and rolls back the entire write.

## Deployment hardening

The deployment matrix now contains 22 pre-downtime gates, including a read-only production integrity classification. After downtime the sequence is:

1. Apply migrations.
2. Reconcile only hash-verified count-only metadata drift.
3. Run strict count **and canonical hash** integrity verification.
4. Certify and start the staged backend.

The current PM2 runtime directory is copied into an immutable deployment-record rollback directory before staging. A failure after downtime restarts that exact snapshot rather than a Git checkout that may already have been reset to newer source.

Future VPS deployments must fetch and execute the deployment script from `origin/main` without resetting the live checkout before the script runs.
