#!/usr/bin/env bash
set -Eeuo pipefail

LIVE="/var/www/kalpavriksha-ops"
PM2_NAME="kalpvriksha-backend"
PORT="8080"
TARGET_COMMIT="${TARGET_COMMIT:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="/var/www/kalpavriksha-e2e-hardening-${STAMP}"
BACKUP="/var/backups/kalpavriksha-runtime/${STAMP}-e2e-hardening"
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
  echo "END-TO-END HARDENING DEPLOYMENT FAILED WITH CODE $rc"
  if [[ "$SWITCHED" == "1" ]]; then
    log "Restoring previous backend and frontend"
    cp -a "$BACKUP/server.js" "$LIVE/backend/src/server.js"
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

log "Checking current live runtime"
test -d "$LIVE/.git"
test -s "$LIVE/backend/src/server.js"
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

log "Extracting source without changing the live checkout"
rm -rf "$STAGE"; mkdir -p "$STAGE"
git -C "$LIVE" archive "$TARGET_COMMIT" | tar -x -C "$STAGE"
ln -s "$LIVE/backend/node_modules" "$STAGE/backend/node_modules"

log "Running only end-to-end authentication, authorization, profile and UX checks"
node --check "$STAGE/backend/src/server.js"
node --check "$STAGE/frontend/src/services/profileService.js"
node --check "$STAGE/frontend/src/services/otpService.js"
node --check "$STAGE/frontend/src/services/financeOutboxService.js"
bash -n "$STAGE/scripts/deploy-end-to-end-hardening-only-vps.sh"
(
  cd "$STAGE"
  node --test \
    tests/frontend/profile-workspace-role-safety.test.mjs \
    tests/frontend/finance-outbox-durability.test.mjs \
    tests/frontend/finance-write-stability.test.mjs \
    tests/backend/profile-registration-and-role-journey.test.mjs \
    tests/backend/end-to-end-hardening-deployment.test.mjs
  node scripts/phase-3-authentication-check.mjs
  node scripts/phase-4-authorization-check.mjs
  node scripts/frontend-backend-contract-check.mjs
)

log "Installing only frontend build dependencies and compiling"
npm ci --prefix "$STAGE/frontend" --include=dev --no-audit --no-fund
VITE_API_URL="https://api.kalpvriksha.co.in" npm run build --prefix "$STAGE/frontend"
test -s "$STAGE/frontend/dist/index.html"
rm -rf "$NEXT_DIST" "$OLD_DIST"
cp -a "$STAGE/frontend/dist" "$NEXT_DIST"
test -s "$NEXT_DIST/index.html"

log "Backing up only the runtime files being replaced"
mkdir -p "$BACKUP"
cp -a "$LIVE/backend/src/server.js" "$BACKUP/server.js"
cp -a "$LIVE/frontend/dist" "$BACKUP/dist"

log "Stopping backend for a short atomic runtime switch"
pm2 stop "$PM2_NAME" >/dev/null
BACKEND_STOPPED=1
wait_closed

cp -a "$STAGE/backend/src/server.js" "$LIVE/backend/src/server.js"
mv "$LIVE/frontend/dist" "$OLD_DIST"
mv "$NEXT_DIST" "$LIVE/frontend/dist"
SWITCHED=1
node --check "$LIVE/backend/src/server.js"
test -s "$LIVE/frontend/dist/index.html"

log "Restarting the permanent live backend"
pm2 restart "$PM2_NAME" --update-env >/dev/null
wait_ready
curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null
BACKEND_STOPPED=0

mkdir -p /var/lib/kalpavriksha
cat > /var/lib/kalpavriksha/end-to-end-hardening-release.json <<JSON
{
  "commit":"$TARGET_COMMIT",
  "deployedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploymentType":"latest-changes-only-end-to-end-hardening",
  "runtimeFiles":["backend/src/server.js","frontend/dist"],
  "databaseTouched":false,
  "migrationsRun":false,
  "fullMatrixRun":false,
  "rollbackDirectory":"$BACKUP"
}
JSON

rm -rf "$OLD_DIST"
trap - ERR INT TERM
cleanup

log "END-TO-END HARDENING LATEST-CHANGES DEPLOYMENT COMPLETED"
echo "Commit: $TARGET_COMMIT"
echo "Full phase matrix: not run"
echo "Database migrations: not run"
echo "Database integrity repair: not run"
echo "New full backup: not created"
echo "Backend dependency install: not run"
echo "Operational PostgreSQL rows rewritten: no"
echo "Updated runtime: backend/src/server.js and frontend/dist only"
echo "Rollback copy: $BACKUP"
