# Kalpavriksha 1.9.24 Upload/Preview Safe Deployment Verification

Date: 2 August 2026

## Verified locally from source

- Security package audit
- Project doctor
- Regression guard
- Production regression audit
- JavaScript syntax across backend, scripts and tests
- JavaScript/JSX parse validation across 55 frontend source files
- Deployment Bash syntax
- 131 frontend tests
- 178 backend tests
- 309 combined tests
- Phase 5 relational schema/integrity verification across 16 tables
- Phase 9 frontend/UX verification
- 76 frontend/backend contract checks across 84 backend routes

## Confirmed protections

- Canonical 100 MB / 20-file upload policy across task, new-task, revision, receipt and chat flows
- Mirrored, cross-tab serialized, actor/target-scoped upload retry identity retained until authoritative confirmation
- No silent eviction of unresolved upload identities
- Progress, speed, ETA, cancellation, partial-success retention and failed-file retry
- Background new-task source uploads that do not block unrelated work
- Chat message-only retry after successful binary upload
- Strict profile-photo, receipt, MIME/signature and active-content validation
- Corrupted content-addressed object detection and atomic repair
- Shared accessible file viewer with bounded text/legacy data and streamed PDF/image/media preview
- Fail-closed private URL normalization and profile-photo tracker blocking
- Actor-scoped, collision-resistant downloaded-file cache without render-time storage work
- Memory-bounded large/legacy-browser downloads
- Truthful WhatsApp Web preparation and explicit delivery confirmation
- Unicode-safe filenames, safe disposition, no-store, nosniff, CSP and range delivery
- Targeted rollback-protected latest-changes deployment

## Runtime preflight enforced on the VPS

`scripts/deploy-upload-preview-irregularity-closure-only-vps.sh` makes the following mandatory before any live runtime file is replaced:

1. Exact target-commit and syntax validation.
2. Targeted upload, preview, profile/cache, request-backpressure, authorization and file-lifecycle tests.
3. Phase 4 authorization verification.
4. Phase 6 private-file storage runtime verification.
5. Phase 9 UX and frontend/backend contract verification.
6. Clean frontend dependency installation and production build.

Only after all checks pass does it briefly stop PM2 and replace `backend/src/server.js`, `backend/src/services/fileStorageService.js` and `frontend/dist`, with rollback protection.

## Packaging-environment limitation

The packaging environment's internal npm mirror returned HTTP 404 for Vite 8.1.4. Therefore a dependency-backed production frontend build is not claimed as locally executed. The dedicated VPS deployment script makes the clean install and production build mandatory before downtime. All dependency-free source, unit, security, database, UX and contract checks passed.

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
