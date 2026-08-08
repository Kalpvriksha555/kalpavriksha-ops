# Release 1.9.27 Verification

Release: `1.9.27-permanent-source-parity-cutover`  
Backend: `2.9.27-permanent-source-parity-cutover`  
Frontend: `2.9.27-permanent-source-parity-cutover`

## Production evidence that drove this release

The 1.9.26 production run proved that the new deployment-lock and private-file snapshot backup worked: the deployment was single-instance, clean-install verification passed, a fresh full backup was VERIFIED, strict relational integrity passed at state version 651, release certification passed, and the staged 1.9.26 backend reached liveness and readiness.

The only cutover blocker was stale non-release source in the permanent live tree. `rsync` could not remove `backend/backend/src`; the permanent release gate then rejected the live tree because its canonical source hash no longer matched the certificate. Rollback restored the prior runtime.

## 1.9.27 focused verification

- Bash syntax: 1.9.27 deployer, 1.9.27 launcher, and superseded 1.9.25/1.9.26 stubs passed.
- JavaScript syntax: source-parity cleaner and release-certification service passed.
- Backend source/regression tests: **148/148 passed**.
- Frontend source/regression tests: **72/72 passed**.
- Deployment runtime closure tests: 5/5 passed.
- Permanent source-parity cutover tests: 3/3 passed.
- Exact rsync-cutover simulation reproduced `cannot delete non-empty directory: backend/backend`; the new parity cleanup removed the stale nested tree and produced an exact release/live source hash match without touching private-file or backend data roots.
- Simulated obsolete live source file was removed.
- Final simulated live source hash exactly matched the release source hash.
- Deployment ordering test proves source parity is enforced after rsync and before production dependency installation and the permanent release gate.
- Cross-release `flock`, backup-timer coordination, converged private-file snapshots, safe pre-live failure behavior, and SSH-independent `Type=simple` launcher remain present.
- Security package audit, project doctor, regression guard, production regression audit, and the 72-check / 83-route frontend/backend contract verifier passed.
- 100 JS/MJS/CJS syntax checks across backend, scripts, tests and desktop entrypoints passed.
- 1.9.25 relational-write integrity implementation remains present.

## Dependency-backed verification

A fresh root `npm ci` could not be rerun inside the artifact sandbox because the sandbox's internal npm mirror returned HTTP 404 for `zod-validation-error@4.0.2`, an existing lockfile dependency. This is the same environment limitation already recorded for 1.9.26.

The production 1.9.26 run itself demonstrated that the VPS can install all three dependency trees successfully and that the full verification/clean-install chain passes there. The 1.9.27 deployer preserves those mandatory pre-live gates and will leave the existing PM2 runtime untouched if they fail before live mutation.
