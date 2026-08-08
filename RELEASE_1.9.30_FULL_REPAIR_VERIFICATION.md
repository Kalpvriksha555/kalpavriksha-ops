# Kalpavriksha 1.9.30 Full Case / Upload Repair Verification

Release: `1.9.30-runtime-persistence-recovery`  
Backend: `2.9.30-runtime-persistence-recovery`  
Frontend: `2.9.30-runtime-persistence-recovery`

## Incident classes closed

This release keeps the 1.9.30 runtime-persistence recovery and closes the linked case-creation and case-file-upload failures reported on 08 Aug 2026.

- A browser-generated new-case identity that collides with an existing server task is treated as a create collision, not as an edit of the existing task. The server allocates the next available identity.
- The frontend replaces its optimistic identity with the server-confirmed identity before any initial source file is uploaded.
- Create requests carry explicit create intent and retry/idempotency information so a retry cannot silently create a duplicate task.
- Initial source-file upload starts only after the case write is confirmed.
- File upload idempotency is scoped to the authenticated actor and upload target; chat/file targets are captured before long transfers so a later UI selection cannot redirect an in-flight upload.
- Upload authorization happens before expensive validation and is repeated against a fresh task snapshot before persistence, preventing a long transfer from committing against stale authorization/task state.
- Background attachment batches are cancellable, preserve retry identity, warn before page unload, and retry only the failed stage where possible.
- Private preview/download handling is bounded and cancellation-aware; large downloads use the browser-native path rather than multi-copy application buffering.
- File-type validation, filename normalization, OOXML checks, media signatures, storage pruning, deduplication validation, and storage-health caching were hardened.
- Profile/session data exposure, profile-photo upload, authentication retry/lock handling, and India date normalization were reconciled with the current security contract.

Two stale source assertions from older hardening phases contradicted newer safety requirements. They were reconciled to the safer current behavior: upload authorization is performed both before validation and again on a fresh task snapshot before commit; multipart `close` cleans temporary files while `finish` performs full cleanup including storage-lease release. Runtime protections were not weakened to satisfy the old assertions.

## Current deployment closure

The root `deploy:vps` entry now points to `scripts/launch-deploy-1.9.30-vps.sh`.

The 1.9.30 full deployer:

- requires extraction outside the permanent live path;
- takes an exclusive cross-release `flock`;
- captures the previous backend runtime, environment, release certificate, frontend build and permanent source for rollback;
- performs clean root/backend/frontend dependency installation;
- runs the complete `npm run verify` gate and clean-install verification before downtime;
- pauses backup timers, creates/verifies a pre-deployment backup, runs migrations and strict relational integrity;
- release-certifies the exact source;
- validates isolated staged liveness/readiness;
- performs source-parity synchronization and an atomic frontend switch;
- validates permanent-path release certification, liveness/readiness and PostgreSQL integrity;
- creates/verifies the first post-deployment backup;
- restores the previous runtime/source on a failed live-stage gate.

The obsolete two-file runtime-persistence hotfix launchers were removed so they cannot be mistaken for the current complete deployment path.

## Independent source verification completed in this repair workspace

- Backend regression suite: **205 passed, 0 failed**.
- Frontend regression suite: **133 passed, 0 failed**.
- Combined source regression suite: **338 passed, 0 failed**.
- Focused case/create/upload collision regression suite: **5 passed, 0 failed**.
- JavaScript/MJS/CJS syntax: **162 files checked, 0 errors**.
- Shell syntax: **19 scripts checked, 0 errors**.
- Security package audit: **passed**.
- Project doctor: **passed**.
- Regression guard: **passed with no warning**.
- Production regression audit: **passed with no warning**.
- Database-integrity source verifier: **passed**, **16 relational tables** verified; round-trip hash `843b713e181057a95e4f97dee2d08d652bb187a4c800929d1e1f4f19fce3e9d5`.
- Release-certification source verifier: **passed** through migration `008.001`.
- Frontend/UX source verifier: **passed**.
- Frontend/backend contract verifier: **72 checks passed across 84 backend routes**.
- Current 1.9.30 deployment-entrypoint tests: **4 passed, 0 failed** and are included in the 205 backend tests above.

## Dependency-backed build/runtime limitation of this audit host

This audit environment cannot currently fetch two public npm tarballs through its enforced package mirror:

- backend clean install stops on mirror HTTP 404 for `yargs-parser@18.1.3`;
- frontend clean install stops on mirror HTTP 404 for `vite@8.1.4`.

Therefore a fresh dependency-backed Vite production build and the dependency-backed phase 2/3/4/6/7 runtime verifier scripts cannot be independently executed on this audit host. This is an environment/package-mirror limitation rather than a source-test failure. No `node_modules` produced by those attempts is included in the release.

The production deployer intentionally repeats clean installation and `npm run verify` against the VPS registry and refuses cutover if those dependency-backed gates or the production database/backup/health gates fail.

## Release assessment

The source tree is clean under every source-level test and verifier that can execute without unavailable third-party packages. The reported create-case/version-conflict and server-ID/file-upload ordering defects are covered by dedicated regressions and the broader suites. Production should still be considered verified only after the guarded 1.9.30 VPS deployment finishes all dependency, database, backup, release-certificate, liveness and readiness gates successfully.
