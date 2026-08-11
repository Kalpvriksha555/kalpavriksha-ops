# Phase 24 clean-install report environment isolation hotfix — 2026-08-11

## Live-discovered failure

The guarded production deployment correctly completed isolated candidate certification and then created and verified a fresh FULL production backup. Production `backend.env` still contained the legacy setting:

`CLEAN_INSTALL_REPORT=/var/lib/kalpavriksha/clean-install-report.json`

That report belonged to the Aug 9 live release (370 source files), while the newly certified candidate report in `.release/clean-install-report.json` covered 456 source files. `release-certify.mjs` inherited the production environment variable and therefore compared the new candidate source tree against the old live report, producing a false clean-install mismatch after backup. Candidate source itself had not drifted.

## Closure

Resume-aware release certification now always resolves the clean-install artifact from the candidate root: `.release/clean-install-report.json`. The production deployer also passes that exact path explicitly in both database-integrity branches. Immediately before production certification, after the fresh backup has completed, the deployer re-runs the cheap candidate-receipt artifact proof so the report SHA-256 and source fingerprints must still match the certified receipt. This does not reinstall dependencies or repeat the full verification chain.

The production environment file is not rewritten merely to remove the legacy variable; runtime compatibility is preserved while certification is isolated from it.

## Data safety retained

The deployment still stops application writes before backup, requires fresh FULL database + private-file backup creation/verification/status before production certification, and never performs an automatic PostgreSQL restore during code rollback. No production business-data logic changed in this hotfix.
