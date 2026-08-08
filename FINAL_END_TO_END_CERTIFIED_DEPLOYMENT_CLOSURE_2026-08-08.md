# Final End-to-End Certified Deployment Closure — 2026-08-08

This closure replaces repeated operator-side certification patches with one immutable GitHub-to-production path.

## Closed deployment/certification defects

- Production snapshot restore no longer depends on a root-only dump path. The snapshot is stored in a dedicated secure temporary directory, explicitly handed to the `postgres` OS user, restored, then deleted.
- Candidate certification no longer uses an `ERR` cleanup trap that can clean resources and then let Bash continue. Cleanup is EXIT-only; INT/TERM exit explicitly.
- Temporary PostgreSQL socket and port are explicit/configurable. The final path uses loopback port 55432 rather than assuming the default local 5432 service.
- Disposable DB role/password TCP authentication is proved before the production-sized candidate test.
- Candidate cleanliness ignores only Git executable-bit differences and still rejects any tracked content change.
- Deployment no longer deletes and reinitializes `.git`; the exact certified GitHub commit remains the release identity through production cutover.
- The deployment script itself re-verifies the exact certification receipt, E2E proof flags, GitHub main parity and tracked-source cleanliness, so direct invocation cannot bypass candidate certification.
- The deployment launcher invokes the deployer through Bash and does not depend on Unix executable mode.
- A single tracked orchestrator now performs temporary PostgreSQL provisioning, restore/auth preflight, isolated candidate certification, temporary database removal, guarded systemd deployment, deployment monitoring, PM2 permanent-path verification, local health/readiness, public API health and public frontend reachability.

## Safety invariants

Candidate writes occur only in a disposable local PostgreSQL clone and disposable file roots. Production PostgreSQL is read by `pg_dump` only during candidate certification. Temporary PostgreSQL is removed before production deployment begins. Production deployment retains its exclusive flock, exact pre-deployment backup, integrity, release certification, source parity, rollback, health, post-deployment integrity and post-deployment backup gates.

The candidate 4 MiB transfer timing gates are internal VPS loopback performance gates; they do not impose 20-second/10-second internet transfer limits on staff browsers.
