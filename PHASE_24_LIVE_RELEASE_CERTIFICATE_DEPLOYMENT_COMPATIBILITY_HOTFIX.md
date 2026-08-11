# Phase 24 live release-certificate deployment compatibility hotfix

## Production finding

The first real Phase 24 deployment attempt on 2026-08-11 stopped before candidate checkout because the existing production runtime returned HTTP 503 from `/api/health/ready`. Every operational readiness check was healthy except `releaseCertificate`.

The live PostgreSQL health probe was healthy at stateVersion 879 with a matching relational snapshot hash and no count mismatches, while backup status was healthy with recent verified recovery points. This is a release-evidence compatibility problem, not a database, storage or persistence failure.

## Closure

`scripts/deploy-1.9.30-vps.sh` now distinguishes strict readiness from one narrowly reviewed legacy state: `releaseCertificate` may be false only when every other readiness check is explicitly true. Any other false or missing readiness check still blocks deployment.

When the compatibility path is used:

1. `CURRENT_RUNTIME_READY_PROOF` remains false.
2. Old PostgreSQL integrity evidence is never reused, even if the database functional source fingerprint is unchanged.
3. Production certification must run a fresh physical PostgreSQL integrity scan after writes are stopped and the exact pre-deployment FULL backup is created and verified.
4. Candidate, staging and permanent readiness remain strict; the new release must have a valid release certificate.
5. Rollback may verify the restored old runtime using the same release-certificate-only compatibility rule, but only when database, storage, disk, backup, persistence, startup and shutdown checks are all healthy. Code rollback still never rewrites the production database.

This is a deployment-only compatibility repair. Application/backend/frontend versions remain unchanged because runtime application behavior did not change.
