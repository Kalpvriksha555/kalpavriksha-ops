#!/usr/bin/env bash
set -Eeuo pipefail

LIVE="${KALPA_LIVE_ROOT:-/var/www/kalpavriksha-ops}"
STAGE="${KALPA_STAGE_ROOT:-/var/www/kalpavriksha-release-1.9.24}"
ENV_FILE="${KALPA_ENV_FILE:-/etc/kalpavriksha/backend.env}"
PM2_NAME="${KALPA_PM2_NAME:-kalpvriksha-backend}"
WORK="${KALPA_DEPLOY_WORK:-/root/kalpavriksha-deploy-$(date +%Y%m%d-%H%M%S)}"

EXPECTED_ROOT_VERSION="1.9.24-overall-stability-data-safety"
EXPECTED_BACKEND_VERSION="2.9.24-overall-stability-data-safety"

mkdir -p "$WORK"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  echo "DEPLOYMENT FAILED: $*" >&2
  exit 1
}

wait_for_health() {
  local endpoint="$1"
  local output="$2"
  local port="${PORT:-8080}"
  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:${port}${endpoint}" >"$output" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

log "Checking production paths and tools"
test -d "$LIVE/.git" || fail "Git repository missing at $LIVE"
test -s "$ENV_FILE" || fail "Environment file missing at $ENV_FILE"
for command_name in git node npm pm2 curl; do
  command -v "$command_name" >/dev/null || fail "$command_name is missing"
done

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export PORT="${PORT:-8080}"
export BIND_HOST="0.0.0.0"
export VITE_API_URL="${VITE_API_URL:-https://api.kalpvriksha.co.in}"

: "${DATABASE_URL:?DATABASE_URL is missing from $ENV_FILE}"
: "${KALPA_BACKUP_ROOT:?KALPA_BACKUP_ROOT is missing from $ENV_FILE}"
: "${RELEASE_CERTIFICATE_PATH:?RELEASE_CERTIFICATE_PATH is missing from $ENV_FILE}"

OLD_SCRIPT="$(pm2 jlist | node -e "
let input='';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  const processInfo = JSON.parse(input).find(item => item.name === process.argv[1]);
  if (!processInfo) process.exit(2);
  process.stdout.write(processInfo.pm2_env.pm_exec_path || '');
});
" "$PM2_NAME")"

OLD_CWD="$(pm2 jlist | node -e "
let input='';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  const processInfo = JSON.parse(input).find(item => item.name === process.argv[1]);
  if (!processInfo) process.exit(2);
  process.stdout.write(processInfo.pm2_env.pm_cwd || '');
});
" "$PM2_NAME")"

test -f "$OLD_SCRIPT" || fail "Current PM2 backend script could not be identified"
test -d "$OLD_CWD" || fail "Current PM2 working directory could not be identified"

log "Fetching the latest GitHub main release"
git -C "$LIVE" fetch origin main
TARGET_COMMIT="$(git -C "$LIVE" rev-parse origin/main)"
echo "GitHub target commit: $TARGET_COMMIT"
echo "Current PM2 script:   $OLD_SCRIPT"

log "Preparing an isolated staging worktree"
git -C "$LIVE" worktree remove "$STAGE" --force 2>/dev/null || true
rm -rf "$STAGE"
git -C "$LIVE" worktree prune
git -C "$LIVE" worktree add --detach "$STAGE" "$TARGET_COMMIT"

ROOT_VERSION="$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version);" "$STAGE/package.json")"
BACKEND_VERSION="$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version);" "$STAGE/backend/package.json")"

echo "Root version:    $ROOT_VERSION"
echo "Backend version: $BACKEND_VERSION"

test "$ROOT_VERSION" = "$EXPECTED_ROOT_VERSION" || fail "GitHub main contains the wrong root version: $ROOT_VERSION"
test "$BACKEND_VERSION" = "$EXPECTED_BACKEND_VERSION" || fail "GitHub main contains the wrong backend version: $BACKEND_VERSION"

grep -q "expectedTaskVersion: createdTaskVersion" "$STAGE/scripts/phase-2-finance-durability-check.mjs" || \
  fail "GitHub main does not contain the finance verifier task-version correction"

grep -q "expectedAmount:9000, amountIn:5000" "$STAGE/scripts/phase-4-authorization-check.mjs" || \
  fail "GitHub main does not contain the authorization verifier finance-context correction"

grep -q "expectedTaskVersion:taskOne.taskVersion" "$STAGE/scripts/phase-4-authorization-check.mjs" || \
  fail "GitHub main does not contain the authorization verifier first task-version correction"

grep -q "expectedTaskVersion:ownUpdate.payload.project.taskVersion" "$STAGE/scripts/phase-4-authorization-check.mjs" || \
  fail "GitHub main does not contain the authorization verifier follow-up task-version correction"

grep -q "expectedTaskVersion:managerCreated.payload.project.taskVersion" "$STAGE/scripts/phase-4-authorization-check.mjs" || \
  fail "GitHub main does not contain the authorization verifier manager-edit task-version correction"

grep -q "status:'Assigned'" "$STAGE/scripts/phase-4-authorization-check.mjs" || \
  fail "GitHub main does not contain the authorization verifier lifecycle-safe assignment correction"

log "Installing clean staging dependencies"
cd "$STAGE"
rm -rf node_modules backend/node_modules frontend/node_modules frontend/dist .release release-certification.json
npm ci --include=dev --no-audit --no-fund
npm ci --prefix frontend --include=dev --no-audit --no-fund

log "Running the complete verification suite"
npm run verify

log "Running isolated clean-install verification"
npm run release:clean-install

log "Creating and verifying the mandatory pre-deployment backup"
npm run backup:create >"$WORK/pre-deployment-backup.json"
npm run backup:verify >"$WORK/pre-deployment-backup-verification.json"
npm run backup:status >"$WORK/pre-deployment-backup-status.json"

CERTIFICATE_BACKUP="$WORK/previous-release-certification.json"
HAD_OLD_CERTIFICATE=0
if [ -f "$RELEASE_CERTIFICATE_PATH" ]; then
  cp "$RELEASE_CERTIFICATE_PATH" "$CERTIFICATE_BACKUP"
  HAD_OLD_CERTIFICATE=1
fi

rollback_to_previous() {
  local rc=$?
  trap - ERR INT TERM
  echo
  echo "DEPLOYMENT FAILED WITH CODE $rc"
  echo "Restoring the previously running backend..."
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  if [ "$HAD_OLD_CERTIFICATE" = "1" ]; then
    mkdir -p "$(dirname "$RELEASE_CERTIFICATE_PATH")"
    cp "$CERTIFICATE_BACKUP" "$RELEASE_CERTIFICATE_PATH"
  else
    rm -f "$RELEASE_CERTIFICATE_PATH"
  fi
  pm2 start "$OLD_SCRIPT" --name "$PM2_NAME" --cwd "$OLD_CWD" --time --update-env || true
  pm2 save || true
  pm2 logs "$PM2_NAME" --lines 100 --nostream || true
  exit "$rc"
}
trap rollback_to_previous ERR INT TERM

log "Stopping application writes"
pm2 stop "$PM2_NAME"

cd "$STAGE"
log "Applying database migrations"
npm run db:migrate --prefix backend

log "Checking relational database integrity"
npm run db:integrity --prefix backend

log "Certifying the exact production release"
rm -f "$RELEASE_CERTIFICATE_PATH"
npm run release:certify
npm run release:gate

log "Starting the verified staging backend"
pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start "$STAGE/backend/src/server.js" --name "$PM2_NAME" --cwd "$STAGE/backend" --time --update-env
wait_for_health "/api/health/live" "$WORK/staging-live-health.json" || fail "Staging backend liveness check failed"
wait_for_health "/api/health/ready" "$WORK/staging-ready-health.json" || fail "Staging backend readiness check failed"
pm2 save

log "Aligning the permanent live checkout"
mkdir -p "$WORK/runtime-preservation"
if [ -f "$LIVE/backend/.env" ]; then cp "$LIVE/backend/.env" "$WORK/runtime-preservation/backend.env"; fi
if [ -d "$LIVE/backend/src/uploads" ]; then
  tar -C "$LIVE/backend/src" -czf "$WORK/runtime-preservation/legacy-uploads.tar.gz" uploads
fi

git -C "$LIVE" reset --hard "$TARGET_COMMIT"
if [ -f "$WORK/runtime-preservation/backend.env" ]; then cp "$WORK/runtime-preservation/backend.env" "$LIVE/backend/.env"; fi
if [ -f "$WORK/runtime-preservation/legacy-uploads.tar.gz" ]; then
  mkdir -p "$LIVE/backend/src"
  tar -C "$LIVE/backend/src" -xzf "$WORK/runtime-preservation/legacy-uploads.tar.gz"
fi

log "Installing production backend dependencies"
rm -rf "$LIVE/backend/node_modules"
npm ci --prefix "$LIVE/backend" --omit=dev --no-audit --no-fund
node --check "$LIVE/backend/src/server.js"

log "Copying the verified frontend build"
test -s "$STAGE/frontend/dist/index.html" || fail "Verified frontend build is missing"
rm -rf "$LIVE/frontend/dist.next" "$LIVE/frontend/dist.previous"
cp -a "$STAGE/frontend/dist" "$LIVE/frontend/dist.next"
if [ -d "$LIVE/frontend/dist" ]; then mv "$LIVE/frontend/dist" "$LIVE/frontend/dist.previous"; fi
mv "$LIVE/frontend/dist.next" "$LIVE/frontend/dist"

rollback_to_staging() {
  local rc=$?
  trap - ERR INT TERM
  echo
  echo "LIVE-PATH SWITCH FAILED WITH CODE $rc"
  echo "Restoring the already verified staging backend..."
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  pm2 start "$STAGE/backend/src/server.js" --name "$PM2_NAME" --cwd "$STAGE/backend" --time --update-env || true
  pm2 save || true
  pm2 logs "$PM2_NAME" --lines 100 --nostream || true
  exit "$rc"
}
trap rollback_to_staging ERR INT TERM

log "Switching PM2 to the permanent live backend path"
pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start "$LIVE/backend/src/server.js" --name "$PM2_NAME" --cwd "$LIVE/backend" --time --update-env
wait_for_health "/api/health/live" "$WORK/live-health.json" || fail "Permanent live backend liveness check failed"
wait_for_health "/api/health/ready" "$WORK/ready-health.json" || fail "Permanent live backend readiness check failed"
pm2 save
rm -rf "$LIVE/frontend/dist.previous"

log "Creating the verified post-deployment backup"
cd "$LIVE"
npm run backup:create >"$WORK/post-deployment-backup.json"
npm run backup:verify >"$WORK/post-deployment-backup-verification.json"
npm run backup:status >"$WORK/post-deployment-backup-status.json"

trap - ERR INT TERM

log "Final health responses"
curl -fsS "http://127.0.0.1:${PORT}/api/health/live"
echo
curl -fsS "http://127.0.0.1:${PORT}/api/health/ready"
echo
curl -fsS "http://127.0.0.1:${PORT}/api/db/health"
echo

log "PM2 status"
pm2 status "$PM2_NAME"

echo
echo "KALPVRIKSHA VERSION 1.9.24 DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "Commit deployed: $TARGET_COMMIT"
echo "Deployment records: $WORK"
