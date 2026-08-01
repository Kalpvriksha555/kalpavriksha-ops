# Release Certification Build-Order Fix

The 1 August 2026 VPS deployment completed all 22 pre-downtime gates, safely rebaselined the known legacy `files` and `performanceRecords` integrity metadata, and passed strict PostgreSQL integrity. It then stopped during release certification because the pre-deployment matrix had just generated `frontend/dist`, while the source-package audit treated every on-disk `dist` file as if it had been bundled in Git.

This release fixes that false failure in two layers:

1. The deployment removes only the verifier-generated `frontend/dist` immediately before certification. `release:certify` then rebuilds the exact production frontend.
2. The security package audit uses `git ls-files` when running inside a Git worktree, so generated untracked build output is not confused with source bundled in the release. Extracted ZIP audits remain strict because no `.git` directory exists there.

No operational database rows are changed by this fix. The production database was already successfully repaired to state version 438 and strict canonical integrity passed before the prior deployment rolled back.
