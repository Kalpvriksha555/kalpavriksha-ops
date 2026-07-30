# Phase 8 Verification Results

## Passed in the preparation environment

- Release-certificate creation and SHA-256 tamper detection
- Source-tree hashing and changed-source detection
- Production environment validation
- Certificate version, freshness, clean-install and backup requirements
- Finance-recovery plan hashing
- Target database fingerprint and state-version checks
- Newer-finance-only selection
- Non-finance task-field preservation
- Exact confirmation requirement
- Changed-target and changed-source rejection
- Four frontend unit tests, including partial-payment preservation
- Migration 008.001 source validation
- Backend and release-script syntax checks

## Environment limitation

The preparation environment's npm proxy returned HTTP 404 for a public transitive package, so a real fresh `npm ci` and frontend build could not be certified here. Phase 8 intentionally does not fabricate a certificate. Run `npm run release:clean-install` and `npm run release:certify` on the user's machine/VPS before deployment.
