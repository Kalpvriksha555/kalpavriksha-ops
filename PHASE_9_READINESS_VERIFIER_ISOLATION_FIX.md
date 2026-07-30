# Phase 9 Readiness Verifier Isolation Fix

- Prevents the Phase 7 isolated reliability server from inheriting production release-certificate requirements.
- Keeps backup-readiness checks active while disabling only the unrelated production certificate gate during the isolated verifier.
- Adds regression coverage for the exact VPS failure observed during staging verification.
- Production readiness and release-certificate enforcement remain unchanged.
