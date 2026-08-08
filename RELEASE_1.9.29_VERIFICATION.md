# Release 1.9.29 Verification

Release: `1.9.29-final-health-probe-closure`
Backend/frontend: `2.9.29-final-health-probe-closure`

This is a narrow successor to 1.9.28. Production evidence showed that the 1.9.28 permanent backend had already passed relational integrity, liveness and readiness when an anonymous `curl -f /api/db/health` received the expected HTTP 401 from the admin-protected route. Curl converted that response to exit code 22 and the strict deployment controller rolled back a healthy release.

1.9.29 removes only that invalid anonymous protected-endpoint probe. It keeps `/api/db/health` protected by `requireAdminSession`, keeps final CLI PostgreSQL integrity verification, and keeps public liveness/readiness probes.

## Verification performed for this successor

- Frontend regression tests: **72 passed, 0 failed**.
- Backend regression tests: **151 passed, 0 failed**.
- Frontend/backend contract verification: **72 checks passed across 83 backend routes**.
- Security package audit, project doctor, regression guard and production regression audit: **PASS**.
- Database-integrity source verifier: **PASS** across 10 migrations and 16 tables.
- Frontend/UX verifier: **PASS**.
- JavaScript/MJS/CJS syntax: **147 files passed**.
- Bash syntax: **11 scripts passed**, including the new 1.9.29 deployment and launcher.
- Node syntax for modified deployment regression tests: PASS.
- Focused deployment runtime regression: PASS, including the new assertion that the final block contains CLI DB integrity + public live/ready probes and contains no `/api/db/health` request.
- Focused permanent source-parity regression: PASS.
- Focused permanent relational-write deployment regression: PASS.
- Static route assertion: `/api/db/health` remains guarded by `requireAdminSession`.
- Version consistency across root/backend/frontend package files and lockfiles: PASS.
- Release manifest regenerated and verified after all changes.
- ZIP integrity verified after packaging.

The dependency lockfiles are unchanged apart from release version metadata. The full production deployment still reruns `npm ci`, the complete verification suite, clean-install verification, verified full backup, migrations, strict database integrity, release certification, staging readiness, permanent source parity, permanent gates, final integrity/health, and the first post-deployment verified backup before reporting success.

A fresh dependency installation was attempted in the artifact sandbox but its internal npm mirror returned HTTP 404 for the existing lockfile package `zod-validation-error@4.0.2`. No dependency or lockfile change was made. The VPS deployment still runs all three `npm ci` gates and the complete verification/build chain before live downtime, as in the successful pre-live portion of 1.9.28.
