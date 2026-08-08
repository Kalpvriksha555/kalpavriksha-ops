#!/usr/bin/env bash
set -Eeuo pipefail

LIVE="/var/www/kalpavriksha-ops"
PORT="8080"
TARGET_COMMIT="${TARGET_COMMIT:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="/var/www/kalpavriksha-performance-isolation-${STAMP}"
BACKUP="/var/backups/kalpavriksha-frontend/${STAMP}-performance-isolation"
NEXT_DIST="$LIVE/frontend/dist.next-${STAMP}"
OLD_DIST="$LIVE/frontend/dist.previous-${STAMP}"
SWITCHED=0

log(){ printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
cleanup(){ rm -rf "$STAGE" "$NEXT_DIST"; }
rollback(){
  local rc=$?
  trap - ERR INT TERM
  echo
  echo "PERFORMANCE ISOLATION FRONTEND DEPLOYMENT FAILED WITH CODE $rc"
  if [[ "$SWITCHED" == "1" ]]; then
    log "Restoring the previous compiled frontend"
    rm -rf "$LIVE/frontend/dist"
    if [[ -d "$OLD_DIST" ]]; then
      mv "$OLD_DIST" "$LIVE/frontend/dist"
    else
      cp -a "$BACKUP/dist" "$LIVE/frontend/dist"
    fi
  fi
  cleanup
  exit "$rc"
}
trap rollback ERR INT TERM

log "Checking the current live frontend and backend"
test -d "$LIVE/.git"
test -s "$LIVE/backend/src/server.js"
test -s "$LIVE/frontend/dist/index.html"
for tool in git node npm curl tar sha256sum; do command -v "$tool" >/dev/null; done
curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/health/ready" >/dev/null

log "Fetching the exact latest GitHub commit"
git -C "$LIVE" fetch origin main
[[ -n "$TARGET_COMMIT" ]] || TARGET_COMMIT="$(git -C "$LIVE" rev-parse origin/main)"
git -C "$LIVE" cat-file -e "${TARGET_COMMIT}^{commit}"
[[ "$(git -C "$LIVE" rev-parse origin/main)" == "$TARGET_COMMIT" ]]
git -C "$LIVE" log -1 --oneline "$TARGET_COMMIT"

log "Extracting source without changing the live Git checkout"
rm -rf "$STAGE"
mkdir -p "$STAGE"
git -C "$LIVE" archive "$TARGET_COMMIT" | tar -x -C "$STAGE"

log "Confirming the required backend baseline is already live"
EXPECTED_BACKEND_SHA="$(sha256sum "$STAGE/backend/src/server.js" | awk '{print $1}')"
LIVE_BACKEND_SHA="$(sha256sum "$LIVE/backend/src/server.js" | awk '{print $1}')"
if [[ "$EXPECTED_BACKEND_SHA" != "$LIVE_BACKEND_SHA" ]]; then
  echo "The live backend does not match the backend required by this frontend-only release."
  echo "Expected backend SHA-256: $EXPECTED_BACKEND_SHA"
  echo "Live backend SHA-256:     $LIVE_BACKEND_SHA"
  echo "No frontend files were changed. Deploy the required backend baseline before this frontend-only update."
  exit 1
fi

log "Running frontend performance, durability, role-safety and regression tests"
node --check "$STAGE/frontend/src/services/financeOutboxService.js"
bash -n "$STAGE/scripts/deploy-performance-isolation-only-vps.sh"
(
  cd "$STAGE"
  npm run test:frontend
  npm run verify:frontend-ux
  npm run verify:integration
)

log "Installing only frontend build dependencies and compiling in isolation"
npm ci --prefix "$STAGE/frontend" --include=dev --no-audit --no-fund
VITE_API_URL="https://api.kalpvriksha.co.in" npm run build --prefix "$STAGE/frontend"
test -s "$STAGE/frontend/dist/index.html"
ASSET_REL="$(grep -oE 'assets/index-[^\"]+\.js' "$STAGE/frontend/dist/index.html" | head -n 1)"
test -n "$ASSET_REL"
test -s "$STAGE/frontend/dist/$ASSET_REL"

rm -rf "$NEXT_DIST" "$OLD_DIST"
cp -a "$STAGE/frontend/dist" "$NEXT_DIST"
test -s "$NEXT_DIST/index.html"
test -s "$NEXT_DIST/$ASSET_REL"

log "Backing up and atomically replacing only the compiled frontend"
mkdir -p "$BACKUP"
cp -a "$LIVE/frontend/dist" "$BACKUP/dist"
mv "$LIVE/frontend/dist" "$OLD_DIST"
mv "$NEXT_DIST" "$LIVE/frontend/dist"
SWITCHED=1

test -s "$LIVE/frontend/dist/index.html"
test -s "$LIVE/frontend/dist/$ASSET_REL"
curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/health/ready" >/dev/null

mkdir -p /var/lib/kalpavriksha
cat > /var/lib/kalpavriksha/performance-isolation-frontend-release.json <<JSON
{
  "commit":"$TARGET_COMMIT",
  "deployedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploymentType":"frontend-only-performance-isolation",
  "runtimeFiles":["frontend/dist"],
  "backendRestarted":false,
  "databaseTouched":false,
  "migrationsRun":false,
  "fullMatrixRun":false,
  "rollbackDirectory":"$BACKUP"
}
JSON

rm -rf "$OLD_DIST"
SWITCHED=0
trap - ERR INT TERM
cleanup

log "PERFORMANCE ISOLATION FRONTEND DEPLOYMENT COMPLETED"
echo "Commit: $TARGET_COMMIT"
echo "Full phase matrix: not run"
echo "Database migrations: not run"
echo "Database integrity repair: not run"
echo "New full backup: not created"
echo "Backend dependencies installed: no"
echo "Backend restarted: no"
echo "PostgreSQL touched: no"
echo "Updated runtime: frontend/dist only"
echo "Rollback copy: $BACKUP"
