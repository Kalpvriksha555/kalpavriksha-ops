# Phase 21 — Resume-Aware Deployment, Atomic Cutover & Rollback Closure

Phase 21 continues from the Phase 20 diagnostics baseline and hardens the release process itself. The deployment path now treats a successful candidate certification as reusable evidence bound to exact source, dependency contracts and build artifacts instead of throwing that evidence away and repeating the same expensive phases during production cutover.

## Closed deployment failure classes

- Candidate certification writes deterministic SHA-256 phase fingerprints for the exact source tree, backend/frontend functional inputs, database-affecting input, dependency contracts, verification input and deployment scripts.
- The receipt is bound to the clean-install report and exact `frontend/dist` bytes/file count. A changed source file, lockfile contract, manifest, clean-install report or frontend artifact invalidates reuse.
- Candidate dependency installation is resumable: an already-complete dependency tree is verified with `npm ls` and reused; stale/missing trees are reinstalled from the lockfiles.
- Re-running the integrated certify/deploy command for the same unchanged, already-certified commit reuses the exact candidate receipt and skips temporary PostgreSQL provisioning, candidate dependency work, full test/build repetition and disposable candidate E2E repetition.
- Production deployment no longer deletes candidate `node_modules`, `frontend/dist` or `.release` evidence and no longer reruns the full `npm run verify` or `release:clean-install` chain after the candidate already passed them.
- If the candidate dependency tree was lost between certification and deployment, only the missing exact lockfile installs plus the real React runtime bootstrap are repeated; the unrelated test chain is not rerun.
- A fresh verified pre-deployment backup remains mandatory because production data can change independently of source code.
- Database migration/integrity work is source-aware. If the backend/database functional input is unchanged and the current production runtime is freshly READY, release certification records an explicit database-integrity reuse receipt. Any backend functional change forces migration and a real PostgreSQL integrity run.
- Permanent backend dependencies are reused only when the backend dependency fingerprint is unchanged and the existing production dependency tree passes `npm ls`; otherwise production dependencies are reinstalled.
- Staging and permanent health probes now prove the exact expected backend package version, preventing an old PM2 process from satisfying a new release probe accidentally.
- Frontend cutover remains atomic through `dist.next`, but Phase 21 additionally hashes `dist.next` and the final live `dist` and requires both to match the certified candidate artifact before/after rename.
- After all live gates pass, an atomic deployment-state receipt records the exact live source and frontend artifact. Re-running the exact same healthy deployment becomes a verified no-op.
- Deployment attempts receive persistent status receipts so a reconnect can distinguish an already-deployed release, a failure before live mutation, a verified rollback, and a rollback that requires operator intervention.
- Runtime rollback now verifies restored source parity plus live/ready health. If rollback cannot be fully verified, the deployer exits with a distinct code (`97`) instead of silently claiming recovery.
- The SSH-independent launcher uses a collision-resistant transient systemd unit, `Type=exec`, unlimited start duration, bounded stop duration and control-group termination. The last-unit pointer is written atomically.

## Safety boundaries

Phase 21 does **not** automatically roll PostgreSQL backwards after a failed deployment. Schema changes must remain backward-compatible/additive, and database restoration remains a deliberate operator action using a verified backup. Runtime/source/frontend rollback is automated; production database replacement is not.

Content-hash reuse is fail-closed. A version-only package bump does not invalidate dependency/database work by itself, but any relevant backend code/dependency change invalidates the database fingerprint, any frontend code/dependency change invalidates the frontend build fingerprint, and any exact source/artifact drift invalidates the candidate/deployment receipt.

## Permanent release gate

`scripts/phase-21-resume-aware-deployment-check.mjs` is part of root `npm run verify` and the full release-verifier matrix. Focused tests additionally exercise version-only bumps, frontend/deployment-only changes, backend changes, candidate artifact tampering and live deployment-state drift.

## Deployment-time gates that are intentionally still real

The source-only Phase 21 package does not pretend to have performed a production cutover. At deployment time the exact GitHub commit must still pass isolated candidate certification (unless an exact unchanged receipt already exists), current production live/ready checks, a fresh verified production backup, production environment validation, any database work invalidated by changed backend input, staging startup/readiness, permanent PM2 path/version checks, source parity, frontend artifact-hash cutover and final public endpoint verification.
