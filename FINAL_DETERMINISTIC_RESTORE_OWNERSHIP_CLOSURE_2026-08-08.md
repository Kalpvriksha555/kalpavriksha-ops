# Final deterministic restore ownership closure — 2026-08-08

This closure fixes the certification-only PostgreSQL ownership defect observed on the VPS at commit `a93f000455ed71708f57d7436f60f7f02444bb22`.

## Observed failure

The integrated PostgreSQL preflight successfully created and restored the probe archive, but the restored table was created while connected as PostgreSQL superuser with `--no-owner`. The table therefore became owned by `postgres`. The generated disposable application role then authenticated correctly over TCP but was denied `SELECT` on the superuser-owned table.

This was a preflight test-model error. Production deployment did not start and the live application remained untouched.

## Permanent correction

The preflight now mirrors the real candidate clone instead of restoring object definitions:

1. A generated disposable role owns both preflight databases.
2. That role creates the source probe table and the identical empty destination probe table over TCP/SCRAM.
3. `pg_dump` writes a custom **data-only** archive for the source probe table.
4. PostgreSQL superuser restores **data only** into the already-existing role-owned destination table with `--disable-triggers --exit-on-error`.
5. The preflight verifies the destination table owner is still the generated role.
6. The generated role logs in over TCP and reads the restored row.

The real candidate clone now also verifies, before any production data is read, that all 15 authoritative destination relational-state tables created by the exact release migrations are owned by the generated disposable candidate role. The production data restore is data-only, fail-fast, and the disposable role must be able to read restored `app_state_metadata` before the candidate backend can start.

Candidate HTTP certification requests now have explicit bounded loopback deadlines in addition to the latency assertions.

## Verification

- Focused candidate/deployment tests: 16/16
- Frontend tests: 148/148
- Backend tests: 222/222
- Combined: 370/370
- Security package audit: PASS
- Project doctor: PASS
- Regression guard: PASS
- Production regression audit: PASS
- Phase 5 database source verifier: 16 tables
- Frontend/backend contract: 72/72 checks across 84 routes
- Bash syntax: 21 files
- Node syntax: 174 JS/MJS/CJS files
- Runtime TODO/FIXME/HACK scan: 0
- `backend/src`: byte-identical to previous candidate
- `frontend/src`: byte-identical to previous candidate

Production cutover remains impossible until the isolated candidate writes the exact `CERTIFIED_FOR_GUARDED_DEPLOYMENT` receipt for the pinned GitHub commit.
