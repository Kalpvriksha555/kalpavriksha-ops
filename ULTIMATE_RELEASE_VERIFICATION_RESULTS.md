# Kalpavriksha 1.9.24 Upload/Preview Safe Deployment Evidence

Date: 2 August 2026

This release closes remaining inconsistencies across file validation, upload retry identity, content-addressed storage, preview, download, profile photos, cache isolation, cancellation, sharing truthfulness and incremental deployment.

## Evidence summary

- 131/131 frontend tests passed.
- 178/178 backend tests passed.
- 309/309 combined tests passed.
- 55 frontend JavaScript/JSX source files parsed without errors.
- Phase 5 verified 16 relational tables.
- Phase 9 frontend/UX verification passed.
- 76 contract checks across 84 backend routes passed.
- Security package audit, project doctor, regression guard and production audit passed.
- Backend/script JavaScript and latest-only deployment Bash syntax passed.

## Important closure evidence

- No upload begins without a durable actor/target-scoped mutation identity.
- Two tabs cannot independently allocate competing retry identities for the same upload.
- Confirmed uploads clear only after an authoritative server file record.
- No unresolved identity is silently discarded to make room for another.
- Existing content-addressed objects are hash-verified and repaired from a valid retry when corrupt.
- Obsolete conflicting upload middleware is absent.
- PDF/image/media previews stream; text and legacy inline preview remain bounded.
- External/unrelated URLs and profile-photo trackers fail closed.
- Original filename casing is retained while extension checks remain case-insensitive.
- Large downloads avoid multiple in-memory copies and clearly disclose browser-managed completion.
- Download cache scope is established at session level and cannot leak across users through render timing.
- WhatsApp Web preparation does not falsely record actual delivery.

## Latest-changes deployment

The isolated VPS preflight validates upload/preview behavior, profile/cache isolation, authorization, private-file storage, UX, contracts and production compilation before downtime. Cutover changes only two backend runtime source files and the compiled frontend, with rollback.

No full matrix, migration, database repair, new full backup, backend dependency installation or operational-row rewrite is part of this deployment.

The packaging environment could not install Vite because its internal package mirror returned HTTP 404. The dependency-backed clean production build and Phase 4/6 runtime checks are mandatory pre-switch gates in the VPS script and are not represented as locally completed evidence.

## Deployment failure-proofing evidence

- Exclusive `flock` prevents concurrent cutovers.
- Git fetch is retried and the exact current `origin/main` commit is pinned.
- Root/backend versions, runtime closure and installed backend dependency versions are verified before downtime.
- Production database/private-storage variables are removed from the isolated verifier environment.
- Frontend dependency preparation is offline-first and retained under an exact package-lock hash.
- Built HTML and every local asset are validated before any live change.
- Both backend files and the complete frontend are backed up and hash-verified before PM2 stops.
- The cutover flag precedes the first file move; every partial-switch failure restores all three runtime components.
- PM2 path, working directory, readiness, liveness and process generation are checked after restart.
- Same-target reruns are successful no-ops; preflight-only mode performs no cutover.
- Successful release evidence is JSON-validated and atomically recorded with the pinned commit and runtime hashes.
