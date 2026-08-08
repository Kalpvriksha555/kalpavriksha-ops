#!/usr/bin/env bash
set -Eeuo pipefail

LIVE="/var/www/kalpavriksha-ops"
PM2_NAME="kalpvriksha-backend"
PORT="8080"
TARGET_COMMIT="${TARGET_COMMIT:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="/var/www/kalpavriksha-upload-preview-${STAMP}"
BACKUP="/var/backups/kalpavriksha-runtime/${STAMP}-upload-preview"
NEXT_DIST="$LIVE/frontend/dist.next-${STAMP}"
OLD_DIST="$LIVE/frontend/dist.previous-${STAMP}"
BACKEND_STOPPED=0
SWITCHED=0

log(){ printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
wait_ready(){ for _ in {1..60}; do curl -fsS "http://127.0.0.1:${PORT}/api/health/ready" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }
wait_closed(){ for _ in {1..30}; do if ! curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null 2>&1; then return 0; fi; sleep 1; done; return 1; }
cleanup(){ rm -rf "$STAGE" "$NEXT_DIST"; }
rollback(){
  local rc=$?
  trap - ERR INT TERM
  echo
  echo "UPLOAD AND PREVIEW DEPLOYMENT FAILED WITH CODE $rc"
  if [[ "$SWITCHED" == "1" ]]; then
    log "Restoring the previous upload backend and frontend"
    cp -a "$BACKUP/server.js" "$LIVE/backend/src/server.js"
    cp -a "$BACKUP/fileStorageService.js" "$LIVE/backend/src/services/fileStorageService.js"
    rm -rf "$LIVE/frontend/dist"
    if [[ -d "$OLD_DIST" ]]; then mv "$OLD_DIST" "$LIVE/frontend/dist"; else cp -a "$BACKUP/dist" "$LIVE/frontend/dist"; fi
  fi
  if [[ "$BACKEND_STOPPED" == "1" ]]; then
    pm2 restart "$PM2_NAME" --update-env >/dev/null || true
    wait_ready || true
  fi
  cleanup
  exit "$rc"
}
trap rollback ERR INT TERM

log "Checking the current live runtime"
test -d "$LIVE/.git"
test -s "$LIVE/backend/src/server.js"
test -s "$LIVE/backend/src/services/fileStorageService.js"
test -s "$LIVE/frontend/dist/index.html"
test -d "$LIVE/backend/node_modules"
for tool in git node npm curl pm2 tar; do command -v "$tool" >/dev/null; done
curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/health/ready" >/dev/null

log "Fetching the exact latest GitHub commit"
git -C "$LIVE" fetch origin main
[[ -n "$TARGET_COMMIT" ]] || TARGET_COMMIT="$(git -C "$LIVE" rev-parse origin/main)"
git -C "$LIVE" cat-file -e "${TARGET_COMMIT}^{commit}"
[[ "$(git -C "$LIVE" rev-parse origin/main)" == "$TARGET_COMMIT" ]]
git -C "$LIVE" log -1 --oneline "$TARGET_COMMIT"

log "Extracting the target without changing the live Git checkout"
rm -rf "$STAGE"
mkdir -p "$STAGE"
git -C "$LIVE" archive "$TARGET_COMMIT" | tar -x -C "$STAGE"
ln -s "$LIVE/backend/node_modules" "$STAGE/backend/node_modules"

log "Running only upload, preview, authorization and UX preflight checks"
node --check "$STAGE/backend/src/server.js"
node --check "$STAGE/backend/src/services/fileStorageService.js"
node --check "$STAGE/frontend/src/services/fileService.js"
bash -n "$STAGE/scripts/deploy-upload-preview-only-vps.sh"
(
  cd "$STAGE"
  node --test \
    tests/frontend/upload-preview-hardening.test.mjs \
    tests/frontend/request-backpressure.test.mjs \
    tests/frontend/overall-stability-data-safety.test.mjs \
    tests/frontend/finance-write-stability.test.mjs \
    tests/backend/upload-preview-hardening.test.mjs \
    tests/backend/file-lifecycle-recovery.test.mjs \
    tests/backend/authorization-before-concurrency.test.mjs
  node scripts/phase-4-authorization-check.mjs
  node scripts/phase-6-file-storage-check.mjs
  node scripts/phase-9-frontend-ux-check.mjs
  node scripts/frontend-backend-contract-check.mjs
)

log "Installing only frontend build dependencies and compiling the target UI"
npm ci --prefix "$STAGE/frontend" --include=dev --no-audit --no-fund
VITE_API_URL="https://api.kalpvriksha.co.in" npm run build --prefix "$STAGE/frontend"
test -s "$STAGE/frontend/dist/index.html"
rm -rf "$NEXT_DIST" "$OLD_DIST"
cp -a "$STAGE/frontend/dist" "$NEXT_DIST"
test -s "$NEXT_DIST/index.html"

log "Backing up only the runtime files that will be replaced"
mkdir -p "$BACKUP"
cp -a "$LIVE/backend/src/server.js" "$BACKUP/server.js"
cp -a "$LIVE/backend/src/services/fileStorageService.js" "$BACKUP/fileStorageService.js"
cp -a "$LIVE/frontend/dist" "$BACKUP/dist"

log "Stopping the backend for the short atomic upload-runtime switch"
pm2 stop "$PM2_NAME" >/dev/null
BACKEND_STOPPED=1
wait_closed

cp -a "$STAGE/backend/src/server.js" "$LIVE/backend/src/server.js"
cp -a "$STAGE/backend/src/services/fileStorageService.js" "$LIVE/backend/src/services/fileStorageService.js"
mv "$LIVE/frontend/dist" "$OLD_DIST"
mv "$NEXT_DIST" "$LIVE/frontend/dist"
SWITCHED=1
node --check "$LIVE/backend/src/server.js"
node --check "$LIVE/backend/src/services/fileStorageService.js"
test -s "$LIVE/frontend/dist/index.html"

log "Restarting the permanent live backend"
pm2 restart "$PM2_NAME" --update-env >/dev/null
wait_ready
curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null
BACKEND_STOPPED=0

mkdir -p /var/lib/kalpavriksha
cat > /var/lib/kalpavriksha/upload-preview-release.json <<JSON
{
  "commit":"$TARGET_COMMIT",
  "deployedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploymentType":"latest-changes-only-upload-preview",
  "runtimeFiles":["backend/src/server.js","backend/src/services/fileStorageService.js","frontend/dist"],
  "databaseTouched":false,
  "migrationsRun":false,
  "fullMatrixRun":false,
  "rollbackDirectory":"$BACKUP"
}
JSON

rm -rf "$OLD_DIST"
trap - ERR INT TERM
cleanup

log "UPLOAD AND PREVIEW LATEST-CHANGES DEPLOYMENT COMPLETED"
echo "Commit: $TARGET_COMMIT"
echo "Full phase matrix: not run"
echo "Database migrations: not run"
echo "Database integrity repair: not run"
echo "New full backup: not created"
echo "Backend dependency install: not run"
echo "Operational PostgreSQL rows rewritten: no"
echo "Updated runtime: backend/src/server.js, backend/src/services/fileStorageService.js and frontend/dist only"
echo "Rollback copy: $BACKUP"
