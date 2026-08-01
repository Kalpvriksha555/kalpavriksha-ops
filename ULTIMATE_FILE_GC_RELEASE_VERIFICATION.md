# Ultimate File-GC and 21-Gate Deployment Verification

## Triggering VPS evidence

The full release verifier matrix completed all sixteen application gates. Fifteen passed; only Phase 6 failed because its legacy assertion still required immediate physical trash movement during the delete request. The deployment correctly aborted before PM2 downtime and did not modify production data.

## Root cause

Immediate movement is unsafe for content-addressed storage. A concurrent upload can deduplicate to an existing hash before its database row is committed. Moving that object during another record's deletion can leave the valid upload pointing to a missing file. The newer delete route therefore retained the object for safe garbage collection, but Phase 6 still tested the older immediate-trash design.

## Final implementation

- Logical deletion commits first and makes the deleted record non-downloadable immediately.
- Active deduplicated references retain the shared object.
- Uploads hold cross-process lease files through response completion, covering the storage-to-database commit window.
- Client disconnects clean temporary files without releasing the storage lease early.
- Stale leases expire after a bounded age so a crashed process cannot block cleanup indefinitely.
- Admin garbage collection requires the exact confirmation `COLLECT FILE STORAGE GARBAGE`.
- Production uses a 24-hour default grace period through `FILE_STORAGE_GC_GRACE_MS`.
- The collector rechecks active database references and leases immediately before the physical move.
- Eligible objects move to private recoverable trash with JSON audit metadata.
- The object move and new lease acquisition coordinate through an exclusive `.gc-lock`, preventing the final check/move race.

## Deployment-gate expansion

The VPS deployment now opts into twenty-one pre-downtime gates:

1. Security package audit
2. Project doctor
3. Regression guard
4. Production regression audit
5. Frontend tests
6. Backend tests
7. Finance durability
8. Authentication
9. Authorization
10. Database integrity
11. Private file storage
12. Operational reliability
13. Release certification
14. Frontend UX
15. Frontend/backend contract
16. Production frontend build
17. Isolated clean install
18. Production-environment validation
19. Backup creation
20. Backup verification
21. Backup health/status

Every selected gate runs and all failures are reported together. PM2 is not stopped unless all twenty-one gates pass.

## Verification completed on the final source tree

- 192 combined frontend/backend tests passed.
- Cross-process storage lease runtime test passed.
- Shared-object and final-reference Phase 6 source probes passed.
- 10/10 dependency-independent release matrix gates passed.
- Database integrity verified 16 tables.
- Frontend/backend contract verified 72 checks across 82 backend routes.
- Deployment source-order/fingerprint audit passed.
- All JavaScript and deployment shell syntax checks passed.

The preparation environment's private npm mirror could not provide two public transitive tarballs, so dependency-backed server integration and clean-install gates could not be rerun locally. The VPS has already demonstrated successful dependency installation; the deployment script runs the complete twenty-one-gate matrix against the isolated staging checkout before downtime.
