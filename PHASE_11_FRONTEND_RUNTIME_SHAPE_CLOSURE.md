# Phase 11 — Frontend Runtime Shape Closure

## Purpose

Phase 10 closed the concrete notification/chat `readBy` defect behind the captured `((intermediate value) || []).some is not a function` crash. Phase 11 broadens that repair into a frontend-wide structural contract: data is not considered an array or record merely because it is truthy or valid JSON.

This phase is intentionally incremental. It does not alter the PostgreSQL schema, production data, backend persistence model, file-retention policy, or deployment cutover architecture.

## Failure classes addressed

The frontend receives state from API responses, browser storage, cross-tab broadcasts, legacy records, file inputs and long-lived cached data. A value such as a string, object, number or JSON `null` can be syntactically valid while still being structurally wrong for `.map()`, `.filter()`, `.some()`, `.slice()`, spread or nested-object use.

Phase 11 therefore closes these classes at the relevant boundaries:

- truthy non-arrays reaching array methods;
- valid JSON with the wrong root type reaching render logic;
- API JSON roots that are `null`, arrays or primitives where an object contract is required;
- project/task nested collection fields changing shape across legacy/new records;
- chat message `mentions`, `taskRefs`, `files`, `readBy` and `reactions` shape drift;
- attendance `breakEvents` and `activeTasks` shape drift;
- file-selection/browser-storage values being treated as generic iterables without validation;
- cross-tab row-delta identifiers being trusted solely because they are truthy.

## Runtime guards

A dedicated `frontend/src/utils/runtimeShapeUtils.js` module now provides explicit structure guards:

- `asArray()` for strict arrays;
- `toArray()` only for intentional non-string iterables such as `FileList`;
- `asRecord()` for non-array object records;
- `firstArray()` for legacy alternative collection fields;
- `parseJsonArray()` and `parseJsonRecord()` for browser-storage boundaries;
- safe array-field and object-entry/value helpers.

The main App/project normalization path canonicalizes all operational task array fields before cache/render use. Nested revision/note attachment collections, ownership/ledger records, chat message collections/reactions and attendance row collections are normalized as well.

Service response parsing was also hardened so successfully parsed but structurally invalid JSON cannot silently propagate as a valid payload.

## Permanent release gate

`scripts/phase-11-frontend-runtime-shape-check.mjs` is now part of both the normal `npm run verify` chain and the full release-verifier matrix. It scans the complete frontend source tree for unsafe truthiness-array method fallbacks and direct browser-storage JSON array operations, and verifies the required structural guards remain present.

`tests/frontend/runtime-shape-contract.test.mjs` adds adversarial cases for strings, objects, scalars, malformed JSON and valid-but-wrong-shape JSON.

## Deployment intent

No database migration or destructive repair is required. The release should continue through the existing resume-aware deployment flow: unchanged backend/database certification phases can reuse their prior receipts; only the changed frontend/runtime-shape and subsequent required release/build gates need new evidence before cutover.
