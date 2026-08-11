# Phase 23 Verification Results

Date: 2026-08-11

Phase 23 was started from the extracted Phase 22 distributable. While moving from source-stability work toward the real VPS candidate-certification path, inspection of `scripts/certify-and-deploy-1.9.30-vps.sh` exposed a deployment-readiness blocker: it unconditionally rejected a production PostgreSQL host of `localhost`, `127.0.0.1`, or `::1`, even though the candidate certifier already provisions its disposable PostgreSQL under a separate `/var/tmp` data root, separate Unix socket directory and dedicated port.

## Repair

- Local production PostgreSQL is now permitted for candidate certification.
- If the local production PostgreSQL port equals `KALPA_TEMP_PG_PORT`, certification fails before any temporary cluster is started.
- The existing occupied-port check remains mandatory.
- The disposable certification PostgreSQL continues to use its own data root, socket directory, role/database namespace and default port `55432`.
- Production remains read-only during metadata inspection and `pg_dump`; certification writes go only to the disposable clone.
- Current root/backend/frontend versions and exact deploy health-version assertions were advanced to the Phase 23 release.
- A permanent Phase 23 verifier was added to both `npm run verify` and the full release-verifier matrix.

## Verification

- Focused Phase 23 backend tests: **4/4 PASS**.
- Permanent Phase 23 certification compatibility gate: **PASS**.
- Full frontend regression suite: **228/228 PASS**.
- Full backend regression suite: **301/301 PASS**.
- Source-only full release-verifier matrix: **20/20 PASS**.
- Frontend/backend contract: **72/72 checks PASS across 86 backend routes**.
- Bash syntax for candidate certification, integrated certification/deployment and production deployment: **PASS**.
- Phase 22 25,000-iteration combined fault soak remains **PASS** after the Phase 23 change.

## Dependency-installed certification boundary

A real `npm ci` was attempted in the isolated ChatGPT execution environment as the next deployment gate, but this environment cannot resolve `registry.npmjs.org` (`curl: (6) Could not resolve host`). An offline install also proved the local npm cache is incomplete (`ENOTCACHED` for `zod-validation-error-4.0.2`). Therefore this package does **not** claim a dependency-installed React/Vite build or live PostgreSQL candidate certification from this environment.

Those gates must run on the VPS/Git checkout with working package-registry/network access using the existing guarded `scripts/certify-and-deploy-1.9.30-vps.sh` entrypoint. The script remains designed to stop before production mutation on any candidate-certification failure.
