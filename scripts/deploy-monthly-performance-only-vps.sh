#!/usr/bin/env bash
set -Eeuo pipefail

LIVE="/var/www/kalpavriksha-ops"
PORT="8080"
TARGET_COMMIT="${TARGET_COMMIT:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="/var/www/kalpavriksha-finance-outbox-${STAMP}"
NEXT_DIST="$LIVE/frontend/dist.next-${STAMP}"
OLD_DIST="$LIVE/frontend/dist.previous-${STAMP}"
BACKUP_DIR="/var/backups/kalpavriksha-frontend/${STAMP}"
SWITCHED=0

log() { printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

cleanup() {
  rm -rf "$STAGE" "$NEXT_DIST"
}

rollback() {
  local rc=$?
  trap - ERR INT TERM
  echo
  echo "FRONTEND-ONLY DEPLOYMENT FAILED WITH CODE $rc"
  if [[ "$SWITCHED" == "1" && -d "$OLD_DIST" ]]; then
    log "Restoring the previous compiled frontend"
    rm -rf "$LIVE/frontend/dist"
    mv "$OLD_DIST" "$LIVE/frontend/dist"
  fi
  cleanup
  exit "$rc"
}
trap rollback ERR INT TERM

log "Checking the current live frontend and backend health"
test -d "$LIVE/.git"
test -s "$LIVE/frontend/dist/index.html"
command -v git >/dev/null
command -v node >/dev/null
command -v npm >/dev/null
command -v curl >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/health/ready" >/dev/null

log "Fetching only the latest GitHub source"
git -C "$LIVE" fetch origin main
if [[ -z "$TARGET_COMMIT" ]]; then
  TARGET_COMMIT="$(git -C "$LIVE" rev-parse origin/main)"
fi
git -C "$LIVE" cat-file -e "${TARGET_COMMIT}^{commit}"
if [[ "$(git -C "$LIVE" rev-parse origin/main)" != "$TARGET_COMMIT" ]]; then
  echo "TARGET_COMMIT is not the current origin/main commit."
  exit 1
fi
printf 'Frontend update target: '
git -C "$LIVE" log -1 --oneline "$TARGET_COMMIT"

log "Extracting the target without changing the live Git checkout"
rm -rf "$STAGE"
mkdir -p "$STAGE"
git -C "$LIVE" archive "$TARGET_COMMIT" | tar -x -C "$STAGE"

log "Running only the tests tied to durable payment sync and monthly analytics"
node --check "$STAGE/frontend/src/services/financeOutboxService.js"
bash -n "$STAGE/scripts/deploy-monthly-performance-only-vps.sh"
(
  cd "$STAGE"
  node --test \
    tests/frontend/finance-outbox-durability.test.mjs \
    tests/frontend/finance-write-stability.test.mjs \
    tests/frontend/monthly-finance-reports-ledger.test.mjs \
    tests/frontend/session-performance.test.mjs
)

log "Installing only frontend build dependencies and compiling the update"
npm ci --prefix "$STAGE/frontend" --include=dev --no-audit --no-fund
VITE_API_URL="https://api.kalpvriksha.co.in" npm run build --prefix "$STAGE/frontend"
test -s "$STAGE/frontend/dist/index.html"

rm -rf "$NEXT_DIST" "$OLD_DIST"
cp -a "$STAGE/frontend/dist" "$NEXT_DIST"
test -s "$NEXT_DIST/index.html"

log "Backing up and atomically switching only frontend/dist"
mkdir -p "$BACKUP_DIR"
cp -a "$LIVE/frontend/dist" "$BACKUP_DIR/dist"
mv "$LIVE/frontend/dist" "$OLD_DIST"
if ! mv "$NEXT_DIST" "$LIVE/frontend/dist"; then
  mv "$OLD_DIST" "$LIVE/frontend/dist"
  exit 1
fi
SWITCHED=1

test -s "$LIVE/frontend/dist/index.html"
curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/api/health/ready" >/dev/null

mkdir -p /var/lib/kalpavriksha
cat > /var/lib/kalpavriksha/frontend-release.json <<JSON
{
  "commit": "$TARGET_COMMIT",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploymentType": "frontend-only-durable-finance-outbox",
  "frontend": "frontend/dist",
  "backendRestarted": false,
  "databaseTouched": false,
  "rollbackDirectory": "$BACKUP_DIR/dist"
}
JSON

rm -rf "$OLD_DIST"
trap - ERR INT TERM
cleanup

log "DURABLE PAYMENT SYNC FRONTEND UPDATE DEPLOYED"
echo "Commit: $TARGET_COMMIT"
echo "Full phase matrix: not run"
echo "Backend files changed: no"
echo "Backend restarted: no"
echo "Database touched: no"
echo "Database integrity repair: not run"
echo "New full backup: not created"
echo "Only frontend/dist was replaced"
echo "Rollback copy: $BACKUP_DIR/dist"
