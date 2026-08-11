# Phase 23 — Production-Local PostgreSQL Certification Closure

Phase 22 completed the planned source-stability programme. Phase 23 is a deployment-readiness repair discovered while exercising the real candidate-certification entrypoint.

## Defect found

`scripts/certify-and-deploy-1.9.30-vps.sh` rejected any production `DATABASE_URL` whose host was `localhost`, `127.0.0.1`, or `::1`, even though the certification design already creates a completely separate PostgreSQL cluster under a unique `/var/tmp` data root, unique Unix socket directory, and dedicated port (default `55432`). A local production PostgreSQL deployment therefore could be blocked before certification despite there being no inherent conflict.

## Closure

Local production PostgreSQL is now supported. The certifier remains fail-closed if the requested temporary certification port equals the production port, and it still rejects any occupied temporary port before starting the disposable cluster. The temporary cluster retains an isolated data directory, socket directory, role/database namespace, matched PostgreSQL major and ICU locale, and is removed before production deployment starts.

No live database write is introduced by this change. Production is read only during metadata inspection and `pg_dump`; all certification mutations occur only in the disposable clone.

A permanent Phase 23 gate is included in `npm run verify` and in the full release-verifier matrix.
