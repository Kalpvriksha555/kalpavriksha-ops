# Kalpavriksha 1.9.25 — Permanent Relational Write Integrity Hardening

## Incident class removed

The earlier production failure was caused by selective row writes publishing integrity metadata from an optimistic in-memory representation while PostgreSQL could normalize or preserve a slightly different physical representation. Presence/attendance and chat-read updates could therefore commit valid rows and then fail selected-row verification or leave the global snapshot hash behind. The backend correctly entered protected mode, but a low-risk telemetry write could temporarily block the whole workspace.

Version `1.9.25-permanent-relational-write-integrity` removes that failure class instead of rebaselining around it.

## Permanent corrections

- Canonical state serialization now follows JSON/PostgreSQL semantics for dates, undefined values, non-finite numbers and custom `toJSON` values.
- BigInt, circular or otherwise non-JSON state is rejected before PostgreSQL rows or integrity metadata can change.
- Selected-row aliases are resolved to immutable primary IDs; an exact primary ID wins and ambiguous aliases fail before mutation.
- Existing PostgreSQL `sort_order` is preserved for row-level updates and is no longer treated as a business-payload mismatch.
- Every selected payload is canonicalized before upsert.
- Selected rows are read back from PostgreSQL and verified by canonical payload hash after upsert.
- The final global snapshot hash is calculated from PostgreSQL read-back, not the intended JavaScript object.
- Routine selective writes reread every touched collection; periodic revisions and full writes independently reread all relational tables.
- The in-process relational shadow is recursively frozen and checked against committed metadata before any selective mutation.
- Metadata publication uses state-version and previous-hash compare-and-swap protection.
- Presence writes are active again. A rolled-back telemetry write is retried and can return HTTP 202 without disabling tasks, files, payments or the rest of the API.
- Historical `STATE_PERSISTENCE` failures are deduplicated and resolved after a verified commit or verified startup, so readiness no longer reports stale incident failures indefinitely.
- Integrity diagnostics expose row ID, collection, payload hashes and changed field names without logging full business payloads.

## Protected error codes

- `RELATIONAL_NON_JSON_STATE`
- `RELATIONAL_ROW_SELECTION_AMBIGUOUS`
- `RELATIONAL_SHADOW_HASH_DIVERGENCE`
- `RELATIONAL_SELECTED_ROW_MISMATCH`
- `RELATIONAL_SELECTED_ROW_DELETE_MISMATCH`
- `RELATIONAL_SELECTED_COLLECTION_MISMATCH`
- `RELATIONAL_METADATA_COMPARE_AND_SWAP_FAILED`
- `PRESENCE_PERSISTENCE_DEFERRED`

Each code fails before metadata publication or after a transaction rollback. None authorizes silent data replacement or automatic restoration of an older database.

## Deployment safety

`scripts/deploy-1.9.27-vps.sh` (the current production deployer that carries this 1.9.25 integrity hardening forward):

1. snapshots the currently running backend and frontend for rollback;
2. performs clean dependency installation and the complete verification suite before downtime;
3. stops writes and creates a verified full backup;
4. runs migrations and strict relational integrity;
5. removes the temporary presence-disable environment setting;
6. certifies the exact ZIP-origin release;
7. starts and health-checks the isolated staged backend;
8. synchronizes the certified source to the permanent live path;
9. switches frontend and backend safely;
10. reruns integrity, health and backup verification;
11. automatically restores the prior runtime, environment and certificate on failure.

The deployment does not restore an older database and does not rewrite operational rows.
