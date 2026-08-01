#!/usr/bin/env bash
set -Eeuo pipefail

LIVE="/var/www/kalpavriksha-ops"
ENV_FILE="/etc/kalpavriksha/backend.env"
PM2_NAME="kalpvriksha-backend"
PORT="8080"
TARGET_COMMIT="${TARGET_COMMIT:-}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="/var/www/kalpavriksha-monthly-performance-${STAMP}"
NEXT_DIST="$LIVE/frontend/dist.next-${STAMP}"
BACKUP_DIR="/var/backups/kalpavriksha-incremental/${STAMP}"
SWITCH_STARTED=0
REPAIR_COMPLETED=0

log() { printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

cleanup() {
  rm -rf "$STAGE" "$NEXT_DIST"
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null 2>&1 \
      && curl -fsS "http://127.0.0.1:${PORT}/api/health/ready" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

rollback() {
  local rc=$?
  trap - ERR INT TERM
  echo
  echo "INCREMENTAL DEPLOYMENT FAILED WITH CODE $rc"

  if [[ "$SWITCH_STARTED" == "1" ]]; then
    log "Restoring the previous backend runtime and frontend"
    cp -a "$BACKUP_DIR/server.js" "$LIVE/backend/src/server.js"
    cp -a "$BACKUP_DIR/postgresStateRepository.js" "$LIVE/backend/src/repositories/postgresStateRepository.js"
    rm -rf "$LIVE/frontend/dist"
    cp -a "$BACKUP_DIR/dist" "$LIVE/frontend/dist"
    pm2 restart "$PM2_NAME" --update-env >/dev/null || true
    wait_for_health || true
  elif [[ "$REPAIR_COMPLETED" == "1" ]]; then
    # The metadata repair advances the state version. Reload the still-current
    # backend so its in-memory version matches the committed PostgreSQL state.
    log "Reloading the existing backend after integrity metadata repair"
    pm2 restart "$PM2_NAME" --update-env >/dev/null || true
    wait_for_health || true
  fi

  cleanup
  exit "$rc"
}
trap rollback ERR INT TERM

log "Checking the current live runtime"
test -d "$LIVE/.git"
test -f "$ENV_FILE"
test -f "$LIVE/backend/src/server.js"
test -f "$LIVE/backend/src/repositories/postgresStateRepository.js"
test -s "$LIVE/frontend/dist/index.html"
test -d "$LIVE/backend/node_modules"
command -v git >/dev/null
command -v node >/dev/null
command -v npm >/dev/null
command -v pm2 >/dev/null
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
printf 'Incremental target: '
git -C "$LIVE" log -1 --oneline "$TARGET_COMMIT"

log "Extracting the target without changing the live Git checkout"
rm -rf "$STAGE"
mkdir -p "$STAGE"
git -C "$LIVE" archive "$TARGET_COMMIT" | tar -x -C "$STAGE"

# Reuse the already installed backend packages. Package manifests and locks are
# not part of this feature revision, so no backend dependency installation runs.
ln -s "$LIVE/backend/node_modules" "$STAGE/backend/node_modules"

log "Checking only the files changed by this analytics revision"
node --check "$STAGE/backend/src/server.js"
node --check "$STAGE/backend/src/repositories/postgresStateRepository.js"
(
  cd "$STAGE"
  node --test \
    tests/frontend/monthly-finance-reports-ledger.test.mjs \
    tests/frontend/session-performance.test.mjs \
    tests/backend/session-performance-hardening.test.mjs \
    tests/backend/relational-integrity-metadata-reconciliation.test.mjs
)

log "Installing only frontend build dependencies and building the latest UI"
npm ci --prefix "$STAGE/frontend" --include=dev --no-audit --no-fund
VITE_API_URL="https://api.kalpvriksha.co.in" npm run build --prefix "$STAGE/frontend"
test -s "$STAGE/frontend/dist/index.html"

rm -rf "$NEXT_DIST"
cp -a "$STAGE/frontend/dist" "$NEXT_DIST"
test -s "$NEXT_DIST/index.html"

log "Backing up only the runtime files that will be replaced"
mkdir -p "$BACKUP_DIR"
cp -a "$LIVE/backend/src/server.js" "$BACKUP_DIR/server.js"
cp -a "$LIVE/backend/src/repositories/postgresStateRepository.js" "$BACKUP_DIR/postgresStateRepository.js"
cp -a "$LIVE/frontend/dist" "$BACKUP_DIR/dist"

log "Repairing only the already-detected stale integrity hash, using the recent verified full backup"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${KALPA_BACKUP_ROOT:?KALPA_BACKUP_ROOT is missing from $ENV_FILE}"
KALPA_INTEGRITY_REPAIR_CONFIRM="REPAIR VERIFIED LEGACY INTEGRITY METADATA" \
  node "$STAGE/backend/scripts/db-integrity-repair.mjs"
REPAIR_COMPLETED=1
node "$STAGE/backend/scripts/db-integrity-audit.mjs"

log "Switching only the two backend runtime files and the compiled frontend"
SWITCH_STARTED=1
pm2 stop "$PM2_NAME" >/dev/null
install -m 0644 "$STAGE/backend/src/server.js" "$LIVE/backend/src/server.js"
install -m 0644 "$STAGE/backend/src/repositories/postgresStateRepository.js" \
  "$LIVE/backend/src/repositories/postgresStateRepository.js"
rm -rf "$LIVE/frontend/dist"
mv "$NEXT_DIST" "$LIVE/frontend/dist"

pm2 restart "$PM2_NAME" --update-env >/dev/null
wait_for_health
pm2 save >/dev/null

curl -fsS "http://127.0.0.1:${PORT}/api/health/live"
echo
curl -fsS "http://127.0.0.1:${PORT}/api/health/ready"
echo

mkdir -p /var/lib/kalpavriksha
cat > /var/lib/kalpavriksha/runtime-release.json <<EOF
{
  "commit": "$TARGET_COMMIT",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploymentType": "monthly-performance-incremental",
  "backendFiles": [
    "backend/src/server.js",
    "backend/src/repositories/postgresStateRepository.js"
  ],
  "frontend": "frontend/dist",
  "rollbackDirectory": "$BACKUP_DIR"
}
EOF

trap - ERR INT TERM
cleanup

log "MONTHLY PERFORMANCE LATEST-CHANGES DEPLOYMENT COMPLETED"
echo "Commit: $TARGET_COMMIT"
echo "Full phase matrix: not run"
echo "Database migrations: not run"
echo "New full backup: not created (recent verified full backup was required)"
echo "Backend dependency install: not run"
echo "Rollback copy: $BACKUP_DIR"
