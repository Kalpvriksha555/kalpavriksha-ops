# Push and Deploy — Upload/Preview Safe Cutover

## Push

Extract the release over the existing local Git repository while preserving `.git`, review `git status`, commit the intended source changes and push `main`.

## Deploy only this latest upload/preview runtime

Do **not** invoke `scripts/deploy-1.9.24-vps.sh` for this update. The correct deployment controller is:

```text
scripts/deploy-upload-preview-irregularity-closure-only-vps.sh
```

Connect to the VPS, then run:

```bash
set -Eeuo pipefail
cd /var/www/kalpavriksha-ops
git fetch origin main
TARGET_COMMIT="$(git rev-parse origin/main)"
git show "${TARGET_COMMIT}:scripts/deploy-upload-preview-irregularity-closure-only-vps.sh" \
  > /root/deploy-upload-preview-safe.sh
chmod +x /root/deploy-upload-preview-safe.sh
TARGET_COMMIT="$TARGET_COMMIT" bash /root/deploy-upload-preview-safe.sh
```

The script performs the complete preflight and build before downtime. It changes only:

- `backend/src/server.js`
- `backend/src/services/fileStorageService.js`
- `frontend/dist`

It does not run the full matrix, migrations, database repair, a new full backup or backend dependency installation.

A successful run ends with:

```text
UPLOAD/PREVIEW SAFE-CUTOVER LATEST-CHANGES DEPLOYMENT COMPLETED
```

## Optional zero-change preflight

To prove the exact target can pass every check and build without stopping PM2:

```bash
KALPA_PREFLIGHT_ONLY=1 TARGET_COMMIT="$TARGET_COMMIT" \
  bash /root/deploy-upload-preview-safe.sh
```

Running the normal command afterward reuses the validated lock-hash dependency cache. Re-running an already deployed target exits successfully without another cutover.
