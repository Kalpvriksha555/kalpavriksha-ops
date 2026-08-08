# Release 1.9.28 Verification

Release: `1.9.28-atomic-frontend-release-gate-closure`
Backend/frontend: `2.9.28-atomic-frontend-release-gate-closure`

This release is a narrow successor to 1.9.27. It closes the production permanent-gate false negative caused by `frontend/dist.previous` entering the certified source hash after an atomic frontend switch.

Mandatory deployment gates remain: dependency install, full verification, clean-install check, exclusive deployment lock, verified converged full backup, migrations, strict relational integrity, release certification, staged liveness/readiness, exact source parity, permanent release gate before and after frontend build switch, permanent liveness/readiness, final relational integrity, and verified post-deployment backup.

Additional rollback hardening: before any live mutation, the deploy controller captures a source-only snapshot of the permanent live tree. Post-sync failure recovery restores that source snapshot with runtime-data exclusions, then restores the previous frontend build, release certificate, environment and immutable PM2 backend. A regression test verifies the capture occurs before downtime and that rollback contains source restoration plus transient `dist.next`/`dist.previous` cleanup.

## Verification completed before packaging

- Frontend regression tests: **72 passed, 0 failed**.
- Backend regression tests: **150 passed, 0 failed**.
- Frontend/backend contract verification: **72 checks passed across 83 backend routes**.
- Security package audit: **passed**.
- Project doctor: **passed**.
- Regression guard: **passed**.
- Production regression audit: **passed**.
- Database-integrity source verifier: **passed** across 10 migrations and 16 tables.
- Frontend/UX verifier: **passed**.
- JavaScript/MJS/CJS syntax: **147 files passed**.
- Bash syntax: **9 scripts passed**.
- The focused atomic-frontend test proves `dist`, `dist.next`, and `dist.previous` do not alter the certified source hash, while a real source change still does.
- The rollback regression test proves the previous permanent live source is captured before downtime and restored on a post-sync failure.

A fresh dependency install was not repeated in the artifact sandbox because the sandbox has no normal external npm registry path. The preceding 1.9.27 production run on the VPS successfully completed all three `npm ci` installations, the full verification suite, clean-install verification, and production build using the unchanged dependency lockfiles. The 1.9.28 deployment repeats those gates on the VPS before stopping the live backend.
