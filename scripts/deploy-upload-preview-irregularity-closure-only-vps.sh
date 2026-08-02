#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

LIVE="${KALPA_LIVE_ROOT:-/var/www/kalpavriksha-ops}"
ENV_FILE="${KALPA_ENV_FILE:-/etc/kalpavriksha/backend.env}"
PM2_NAME="${KALPA_PM2_NAME:-kalpvriksha-backend}"
TARGET_COMMIT="${TARGET_COMMIT:-}"
EXPECTED_ROOT_VERSION="1.9.24-overall-stability-data-safety"
EXPECTED_BACKEND_VERSION="2.9.24-overall-stability-data-safety"
DEPLOYMENT_ID="upload-preview-irregularity-closure-safe-cutover-v2"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
STAGE="/var/www/kalpavriksha-upload-preview-closure-${STAMP}"
BACKUP="/var/backups/kalpavriksha-runtime/${STAMP}-upload-preview-closure"
LOCK_FILE="/var/lock/kalpavriksha-upload-preview-deploy.lock"
FRONTEND_CACHE_ROOT="/var/cache/kalpavriksha/frontend-deps"
RELEASE_RECORD="/var/lib/kalpavriksha/upload-preview-irregularity-closure-release.json"
NEXT_DIST="$LIVE/frontend/dist.next-${STAMP}"
OLD_DIST="$LIVE/frontend/dist.previous-${STAMP}"
NEXT_SERVER="$LIVE/backend/src/.server.js.next-${STAMP}"
NEXT_FILE_SERVICE="$LIVE/backend/src/services/.fileStorageService.js.next-${STAMP}"
PORT="8080"

BACKEND_WAS_ONLINE=0
BACKEND_STOP_REQUESTED=0
CUTOVER_STARTED=0
SUCCESS=0
OLD_PID=""
OLD_RESTART_TIME=""
TARGET_SERVER_HASH=""
TARGET_FILE_SERVICE_HASH=""
TARGET_DIST_HASH=""
FRONTEND_CACHE_TMP=""

log() { printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
warn() { printf '\nWARNING: %s\n' "$*" >&2; }
fail() { printf '\nDEPLOYMENT PRECHECK FAILED: %s\n' "$*" >&2; exit 1; }

retry() {
  local attempts="$1" delay="$2"; shift 2
  local attempt=1
  until "$@"; do
    if (( attempt >= attempts )); then return 1; fi
    warn "Attempt ${attempt}/${attempts} failed: $*"
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

pm2_field() {
  local field="$1"
  pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const [name, field] = process.argv.slice(1);
  const row = JSON.parse(input).find(item => item.name === name);
  if (!row) process.exit(2);
  const values = {
    status: row.pm2_env?.status || "",
    script: row.pm2_env?.pm_exec_path || "",
    cwd: row.pm2_env?.pm_cwd || "",
    pid: String(row.pid || ""),
    restartTime: String(row.pm2_env?.restart_time ?? ""),
    watch: row.pm2_env?.watch ? "true" : "false"
  };
  process.stdout.write(values[field] ?? "");
});
' "$PM2_NAME" "$field"
}

wait_ready() {
  local output="${1:-/tmp/kalpavriksha-ready-${STAMP}.json}"
  for _ in $(seq 1 90); do
    if curl --max-time 5 -fsS "http://127.0.0.1:${PORT}/api/health/ready" >"$output" 2>/dev/null &&
      node - "$output" <<'NODE'
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value?.ok !== true || String(value?.status || '').toUpperCase() !== 'READY') process.exit(1);
NODE
    then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_live() {
  for _ in $(seq 1 30); do
    if curl --max-time 5 -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

wait_closed() {
  for _ in $(seq 1 45); do
    if ! curl --max-time 2 -fsS "http://127.0.0.1:${PORT}/api/health/live" >/dev/null 2>&1; then
      if command -v ss >/dev/null 2>&1; then
        if ! ss -ltn "sport = :${PORT}" | tail -n +2 | grep -q .; then return 0; fi
      else
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

sha256_file() { sha256sum "$1" | awk '{print $1}'; }

tree_hash() {
  node - "$1" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.argv[2]);
const rows = [];
const walk = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile()) {
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      rows.push(`${relative}\0${crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}`);
    }
  }
};
walk(root);
process.stdout.write(crypto.createHash('sha256').update(rows.join('\n')).digest('hex'));
NODE
}

validate_frontend_dist() {
  node - "$1" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2]);
const indexPath = path.join(root, 'index.html');
if (!fs.existsSync(indexPath) || fs.statSync(indexPath).size < 100) throw new Error('Built index.html is missing or empty.');
const html = fs.readFileSync(indexPath, 'utf8');
if (/localhost|127\.0\.0\.1|:\/\/0\.0\.0\.0/i.test(html)) throw new Error('Built frontend contains a development endpoint.');
const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
for (const reference of references) {
  if (/^(?:https?:|data:|#)/i.test(reference)) continue;
  const clean = reference.split(/[?#]/, 1)[0].replace(/^\//, '');
  const file = path.join(root, clean);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error(`Built asset is missing or empty: ${reference}`);
  }
}
const jsAssets = fs.readdirSync(path.join(root, 'assets')).filter(name => name.endsWith('.js'));
if (jsAssets.length === 0) throw new Error('No JavaScript asset was produced.');
NODE
}

cleanup() {
  rm -rf "$STAGE" "$NEXT_DIST"
  rm -f "$NEXT_SERVER" "$NEXT_FILE_SERVICE"
  rm -f "/tmp/kalpavriksha-ready-${STAMP}.json"
  if [[ -n "$FRONTEND_CACHE_TMP" ]]; then rm -rf "$FRONTEND_CACHE_TMP"; fi
}

restart_previous_backend() {
  if pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1; then
    wait_ready "/tmp/kalpavriksha-ready-${STAMP}.json" && return 0
  fi
  return 1
}

rollback() {
  local rc="$1"
  trap - EXIT ERR INT TERM
  echo
  echo "UPLOAD/PREVIEW SAFE-CUTOVER DEPLOYMENT FAILED WITH CODE $rc"

  if [[ "$CUTOVER_STARTED" == "1" ]]; then
    log "Restoring the complete previous upload/preview runtime"
    pm2 stop "$PM2_NAME" >/dev/null 2>&1 || true
    wait_closed || true

    if [[ -s "$BACKUP/server.js" ]]; then cp -a "$BACKUP/server.js" "$LIVE/backend/src/server.js"; fi
    if [[ -s "$BACKUP/fileStorageService.js" ]]; then cp -a "$BACKUP/fileStorageService.js" "$LIVE/backend/src/services/fileStorageService.js"; fi

    rm -rf "$LIVE/frontend/dist"
    if [[ -d "$OLD_DIST" ]]; then
      mv "$OLD_DIST" "$LIVE/frontend/dist"
    elif [[ -d "$BACKUP/dist" ]]; then
      cp -a "$BACKUP/dist" "$LIVE/frontend/dist"
    fi
  fi

  if [[ "$BACKEND_WAS_ONLINE" == "1" && ( "$BACKEND_STOP_REQUESTED" == "1" || "$CUTOVER_STARTED" == "1" ) ]]; then
    if restart_previous_backend; then
      echo "Previous backend restored and READY."
    else
      echo "CRITICAL: previous backend files were restored but PM2 did not become READY." >&2
      pm2 status "$PM2_NAME" >&2 || true
    fi
  fi

  cleanup || true
  if [[ -d "$BACKUP" ]]; then
    echo "Rollback runtime retained at: $BACKUP"
  else
    echo "No live cutover occurred; no rollback runtime was required."
  fi
  exit "$rc"
}

on_exit() {
  local rc=$?
  if [[ "$SUCCESS" == "1" && "$rc" == "0" ]]; then
    cleanup || true
    return 0
  fi
  rollback "$rc"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || fail "Another Kalpavriksha upload/preview deployment is already running."

log "Checking the live runtime and deployment prerequisites"
for tool in git node npm curl pm2 tar flock sha256sum df awk grep cmp realpath; do command -v "$tool" >/dev/null || fail "$tool is missing"; done
test -d "$LIVE/.git" || fail "Git repository missing at $LIVE"
test -s "$ENV_FILE" || fail "Production environment file missing at $ENV_FILE"
test -s "$LIVE/backend/src/server.js" || fail "Live server.js is missing"
test -s "$LIVE/backend/src/services/fileStorageService.js" || fail "Live fileStorageService.js is missing"
test -s "$LIVE/frontend/dist/index.html" || fail "Live frontend build is missing"
test -d "$LIVE/backend/node_modules" || fail "Live backend dependencies are missing"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
PORT="${PORT:-8080}"
: "${DATABASE_URL:?DATABASE_URL is missing from $ENV_FILE}"

CURRENT_PM2_STATUS="$(pm2_field status)"
CURRENT_PM2_SCRIPT="$(pm2_field script)"
CURRENT_PM2_CWD="$(pm2_field cwd)"
OLD_PID="$(pm2_field pid)"
OLD_RESTART_TIME="$(pm2_field restartTime)"
CURRENT_PM2_WATCH="$(pm2_field watch)"
[[ "$CURRENT_PM2_STATUS" == "online" ]] || fail "PM2 process $PM2_NAME is not online"
[[ "$CURRENT_PM2_WATCH" == "false" ]] || fail "PM2 watch mode must be disabled for an atomic runtime cutover"
[[ "$(realpath "$CURRENT_PM2_SCRIPT")" == "$(realpath "$LIVE/backend/src/server.js")" ]] || fail "PM2 is not running the permanent live backend path"
[[ "$(realpath "$CURRENT_PM2_CWD")" == "$(realpath "$LIVE/backend")" ]] || fail "PM2 working directory is not $LIVE/backend"
BACKEND_WAS_ONLINE=1
wait_live || fail "Current backend liveness check failed"
wait_ready "/tmp/kalpavriksha-ready-${STAMP}.json" || fail "Current backend readiness check failed"

AVAILABLE_KB="$(df -Pk "$LIVE" | awk 'NR==2 {print $4}')"
[[ "$AVAILABLE_KB" =~ ^[0-9]+$ ]] || fail "Could not determine free disk space"
(( AVAILABLE_KB >= 2097152 )) || fail "At least 2 GB of free disk space is required before staging"

log "Fetching and pinning the exact GitHub main commit"
retry 3 3 git -C "$LIVE" fetch --prune origin main || fail "Could not fetch origin/main after three attempts"
[[ -n "$TARGET_COMMIT" ]] || TARGET_COMMIT="$(git -C "$LIVE" rev-parse origin/main)"
git -C "$LIVE" cat-file -e "${TARGET_COMMIT}^{commit}" || fail "Target commit does not exist"
[[ "$(git -C "$LIVE" rev-parse origin/main)" == "$TARGET_COMMIT" ]] || fail "Target commit is not the current origin/main"
git -C "$LIVE" log -1 --oneline "$TARGET_COMMIT"

log "Extracting the pinned target without modifying the live checkout"
rm -rf "$STAGE"
mkdir -p "$STAGE"
git -C "$LIVE" archive "$TARGET_COMMIT" | tar -x -C "$STAGE"
test -s "$STAGE/scripts/deploy-upload-preview-irregularity-closure-only-vps.sh" || fail "Target deployment script is missing"

ROOT_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version)" "$STAGE/package.json")"
BACKEND_VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).version)" "$STAGE/backend/package.json")"
[[ "$ROOT_VERSION" == "$EXPECTED_ROOT_VERSION" ]] || fail "Unexpected root version: $ROOT_VERSION"
[[ "$BACKEND_VERSION" == "$EXPECTED_BACKEND_VERSION" ]] || fail "Unexpected backend version: $BACKEND_VERSION"
grep -q "DEPLOYMENT_ID=\"$DEPLOYMENT_ID\"" "$STAGE/scripts/deploy-upload-preview-irregularity-closure-only-vps.sh" || fail "Target does not contain the safe-cutover deployment revision"

TARGET_SERVER_HASH="$(sha256_file "$STAGE/backend/src/server.js")"
TARGET_FILE_SERVICE_HASH="$(sha256_file "$STAGE/backend/src/services/fileStorageService.js")"

if [[ -s "$RELEASE_RECORD" ]]; then
  mapfile -t RECORDED < <(node - "$RELEASE_RECORD" <<'NODE'
const fs = require('fs');
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  for (const field of ['deploymentId', 'commit', 'serverSha256', 'fileStorageServiceSha256', 'frontendTreeSha256']) {
    console.log(String(value[field] || ''));
  }
} catch {
  process.exit(0);
}
NODE
  )
  if [[ "${RECORDED[0]:-}" == "$DEPLOYMENT_ID" &&
        "${RECORDED[1]:-}" == "$TARGET_COMMIT" &&
        "${RECORDED[2]:-}" == "$TARGET_SERVER_HASH" &&
        "${RECORDED[3]:-}" == "$TARGET_FILE_SERVICE_HASH" &&
        "$(sha256_file "$LIVE/backend/src/server.js")" == "${RECORDED[2]:-missing}" &&
        "$(sha256_file "$LIVE/backend/src/services/fileStorageService.js")" == "${RECORDED[3]:-missing}" &&
        "$(tree_hash "$LIVE/frontend/dist")" == "${RECORDED[4]:-missing}" ]]; then
    log "The pinned commit and all recorded runtime hashes are already active"
    SUCCESS=1
    trap - EXIT INT TERM
    cleanup || true
    echo "No tests, dependency installation, build or cutover were required."
    echo "Commit already active: $TARGET_COMMIT"
    exit 0
  fi
fi

log "Verifying that this incremental backend is runtime-complete"
node - "$STAGE" "$LIVE" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [stage, live] = process.argv.slice(2).map(path.resolve);
const allowed = new Set(['server.js', 'services/fileStorageService.js']);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const collect = root => {
  const out = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && ['.js', '.mjs', '.cjs', '.json'].includes(path.extname(entry.name))) {
        out.set(path.relative(root, absolute).split(path.sep).join('/'), hash(absolute));
      }
    }
  };
  walk(root);
  return out;
};
const stageFiles = collect(path.join(stage, 'backend/src'));
const liveFiles = collect(path.join(live, 'backend/src'));
const differences = [];
for (const name of stageFiles.keys()) {
  if (allowed.has(name)) continue;
  if (stageFiles.get(name) !== liveFiles.get(name)) differences.push(name);
}
if (differences.length) {
  console.error('Incremental deployment would omit changed backend runtime files:');
  for (const name of differences) console.error(` - backend/src/${name}`);
  process.exit(1);
}

const targetPackage = JSON.parse(fs.readFileSync(path.join(stage, 'backend/package.json'), 'utf8'));
for (const [name, expected] of Object.entries(targetPackage.dependencies || {})) {
  const installedPath = path.join(live, 'backend/node_modules', name, 'package.json');
  if (!fs.existsSync(installedPath)) throw new Error(`Missing live backend dependency: ${name}`);
  const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8')).version;
  if (installed !== expected) throw new Error(`Backend dependency mismatch for ${name}: expected ${expected}, installed ${installed}`);
}
NODE
npm ls --prefix "$LIVE/backend" --omit=dev --depth=0 >/dev/null

ln -s "$LIVE/backend/node_modules" "$STAGE/backend/node_modules"

log "Running isolated upload, preview, authorization and UX preflight checks"
node --check "$STAGE/backend/src/server.js"
node --check "$STAGE/backend/src/services/fileStorageService.js"
node --check "$STAGE/frontend/src/services/fileService.js"
test -s "$STAGE/backend/.env.example"
bash -n "$STAGE/scripts/deploy-upload-preview-irregularity-closure-only-vps.sh"
(
  cd "$STAGE"
  unset DATABASE_URL KALPA_DATABASE_URL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
  unset RELEASE_CERTIFICATE_PATH KALPA_BACKUP_ROOT PRIVATE_FILE_ROOT
  export NODE_ENV=test
  node --test \
    tests/frontend/upload-preview-hardening.test.mjs \
    tests/frontend/profile-workspace-role-safety.test.mjs \
    tests/frontend/request-backpressure.test.mjs \
    tests/frontend/overall-stability-data-safety.test.mjs \
    tests/frontend/finance-write-stability.test.mjs \
    tests/backend/upload-preview-hardening.test.mjs \
    tests/backend/upload-preview-irregularity-deployment.test.mjs \
    tests/backend/upload-preview-deployment-failure-safety.test.mjs \
    tests/backend/package-environment-example.test.mjs \
    tests/backend/file-lifecycle-recovery.test.mjs \
    tests/backend/authorization-before-concurrency.test.mjs \
    tests/backend/request-state-integrity.test.mjs
  node scripts/phase-4-authorization-check.mjs
  node scripts/phase-6-file-storage-check.mjs
  node scripts/phase-9-frontend-ux-check.mjs
  node scripts/frontend-backend-contract-check.mjs
)

log "Preparing a deterministic frontend dependency cache"
FRONTEND_LOCK_HASH="$(sha256_file "$STAGE/frontend/package-lock.json")"
FRONTEND_CACHE="$FRONTEND_CACHE_ROOT/$FRONTEND_LOCK_HASH"
mkdir -p "$FRONTEND_CACHE_ROOT"

cache_valid=0
if [[ -d "$FRONTEND_CACHE/node_modules" && -x "$FRONTEND_CACHE/node_modules/.bin/vite" ]]; then
  if cmp -s "$STAGE/frontend/package.json" "$FRONTEND_CACHE/package.json" &&
     cmp -s "$STAGE/frontend/package-lock.json" "$FRONTEND_CACHE/package-lock.json" &&
     npm ls --prefix "$FRONTEND_CACHE" --depth=0 >/dev/null 2>&1; then
    cache_valid=1
  else
    rm -rf "$FRONTEND_CACHE"
  fi
fi

if [[ "$cache_valid" == "0" ]]; then
  rm -rf "$STAGE/frontend/node_modules"
  if ! npm ci --prefix "$STAGE/frontend" --include=dev --offline --no-audit --no-fund; then
    rm -rf "$STAGE/frontend/node_modules"
    npm ci --prefix "$STAGE/frontend" --include=dev --prefer-offline \
      --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=15000 \
      --no-audit --no-fund
  fi
  npm ls --prefix "$STAGE/frontend" --depth=0 >/dev/null
  FRONTEND_CACHE_TMP="${FRONTEND_CACHE}.tmp-${STAMP}"
  rm -rf "$FRONTEND_CACHE_TMP"
  mkdir -p "$FRONTEND_CACHE_TMP"
  cp -a "$STAGE/frontend/package.json" "$FRONTEND_CACHE_TMP/package.json"
  cp -a "$STAGE/frontend/package-lock.json" "$FRONTEND_CACHE_TMP/package-lock.json"
  mv "$STAGE/frontend/node_modules" "$FRONTEND_CACHE_TMP/node_modules"
  rm -rf "$FRONTEND_CACHE"
  mv "$FRONTEND_CACHE_TMP" "$FRONTEND_CACHE"
  FRONTEND_CACHE_TMP=""
fi

rm -rf "$STAGE/frontend/node_modules"
ln -s "$FRONTEND_CACHE/node_modules" "$STAGE/frontend/node_modules"

log "Building and validating the pinned frontend before downtime"
VITE_API_URL="https://api.kalpvriksha.co.in" npm run build --prefix "$STAGE/frontend"
validate_frontend_dist "$STAGE/frontend/dist"
TARGET_DIST_HASH="$(tree_hash "$STAGE/frontend/dist")"

rm -rf "$NEXT_DIST" "$OLD_DIST"
cp -a "$STAGE/frontend/dist" "$NEXT_DIST"
cp -a "$STAGE/backend/src/server.js" "$NEXT_SERVER"
cp -a "$STAGE/backend/src/services/fileStorageService.js" "$NEXT_FILE_SERVICE"
[[ "$(sha256_file "$NEXT_SERVER")" == "$TARGET_SERVER_HASH" ]]
[[ "$(sha256_file "$NEXT_FILE_SERVICE")" == "$TARGET_FILE_SERVICE_HASH" ]]
[[ "$(tree_hash "$NEXT_DIST")" == "$TARGET_DIST_HASH" ]]

if [[ "$(sha256_file "$LIVE/backend/src/server.js")" == "$TARGET_SERVER_HASH" &&
      "$(sha256_file "$LIVE/backend/src/services/fileStorageService.js")" == "$TARGET_FILE_SERVICE_HASH" &&
      "$(tree_hash "$LIVE/frontend/dist")" == "$TARGET_DIST_HASH" ]]; then
  log "The exact target runtime is already deployed and healthy"
  SUCCESS=1
  trap - EXIT INT TERM
  cleanup || true
  echo "No cutover was required. Commit already active: $TARGET_COMMIT"
  exit 0
fi

if [[ "${KALPA_PREFLIGHT_ONLY:-0}" == "1" ]]; then
  log "Preflight-only mode completed successfully; no live file was changed"
  SUCCESS=1
  trap - EXIT INT TERM
  cleanup || true
  exit 0
fi

log "Creating and verifying the runtime rollback copy"
mkdir -p "$BACKUP"
cp -a "$LIVE/backend/src/server.js" "$BACKUP/server.js"
cp -a "$LIVE/backend/src/services/fileStorageService.js" "$BACKUP/fileStorageService.js"
cp -a "$LIVE/frontend/dist" "$BACKUP/dist"
[[ "$(sha256_file "$BACKUP/server.js")" == "$(sha256_file "$LIVE/backend/src/server.js")" ]]
[[ "$(sha256_file "$BACKUP/fileStorageService.js")" == "$(sha256_file "$LIVE/backend/src/services/fileStorageService.js")" ]]
[[ "$(tree_hash "$BACKUP/dist")" == "$(tree_hash "$LIVE/frontend/dist")" ]]

log "Stopping the backend for the short runtime cutover"
BACKEND_STOP_REQUESTED=1
pm2 stop "$PM2_NAME" >/dev/null
wait_closed || fail "Port $PORT did not close after stopping PM2"

CUTOVER_STARTED=1
mv -f "$NEXT_SERVER" "$LIVE/backend/src/server.js"
mv -f "$NEXT_FILE_SERVICE" "$LIVE/backend/src/services/fileStorageService.js"
mv "$LIVE/frontend/dist" "$OLD_DIST"
mv "$NEXT_DIST" "$LIVE/frontend/dist"

node --check "$LIVE/backend/src/server.js"
node --check "$LIVE/backend/src/services/fileStorageService.js"
validate_frontend_dist "$LIVE/frontend/dist"
[[ "$(sha256_file "$LIVE/backend/src/server.js")" == "$TARGET_SERVER_HASH" ]]
[[ "$(sha256_file "$LIVE/backend/src/services/fileStorageService.js")" == "$TARGET_FILE_SERVICE_HASH" ]]
[[ "$(tree_hash "$LIVE/frontend/dist")" == "$TARGET_DIST_HASH" ]]

log "Restarting and verifying the permanent live backend"
pm2 restart "$PM2_NAME" --update-env >/dev/null
wait_ready "/tmp/kalpavriksha-ready-${STAMP}.json" || fail "New backend did not become READY within 90 seconds"
wait_live || fail "New backend liveness check failed"

NEW_PM2_SCRIPT="$(pm2_field script)"
NEW_PM2_CWD="$(pm2_field cwd)"
NEW_PID="$(pm2_field pid)"
NEW_RESTART_TIME="$(pm2_field restartTime)"
[[ "$(realpath "$NEW_PM2_SCRIPT")" == "$(realpath "$LIVE/backend/src/server.js")" ]] || fail "PM2 restarted a non-live script path"
[[ "$(realpath "$NEW_PM2_CWD")" == "$(realpath "$LIVE/backend")" ]] || fail "PM2 restarted with the wrong working directory"
[[ -n "$NEW_PID" ]] || fail "PM2 did not report a live process ID after restart"
if [[ "$NEW_PID" == "$OLD_PID" && "$NEW_RESTART_TIME" == "$OLD_RESTART_TIME" ]]; then
  fail "PM2 did not report a new process identity or restart generation"
fi

BACKEND_STOP_REQUESTED=0
rm -rf "$OLD_DIST"

log "Recording the successful pinned deployment atomically"
mkdir -p "$(dirname "$RELEASE_RECORD")"
RELEASE_TMP="${RELEASE_RECORD}.tmp-${STAMP}"
cat > "$RELEASE_TMP" <<JSON
{
  "schemaVersion": 2,
  "deploymentId": "$DEPLOYMENT_ID",
  "commit": "$TARGET_COMMIT",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploymentType": "latest-changes-only-upload-preview-irregularity-closure",
  "runtimeFiles": ["backend/src/server.js", "backend/src/services/fileStorageService.js", "frontend/dist"],
  "serverSha256": "$TARGET_SERVER_HASH",
  "fileStorageServiceSha256": "$TARGET_FILE_SERVICE_HASH",
  "frontendTreeSha256": "$TARGET_DIST_HASH",
  "databaseTouched": false,
  "migrationsRun": false,
  "fullMatrixRun": false,
  "backendDependenciesInstalled": false,
  "rollbackDirectory": "$BACKUP"
}
JSON
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$RELEASE_TMP"
mv -f "$RELEASE_TMP" "$RELEASE_RECORD"

SUCCESS=1
trap - EXIT INT TERM
cleanup || true

log "UPLOAD/PREVIEW SAFE-CUTOVER LATEST-CHANGES DEPLOYMENT COMPLETED"
echo "Commit: $TARGET_COMMIT"
echo "Full phase matrix: not run"
echo "Database migrations: not run"
echo "Database integrity repair: not run"
echo "New full backup: not created"
echo "Backend dependency install: not run"
echo "Operational PostgreSQL rows rewritten: no"
echo "Updated runtime: backend/src/server.js, backend/src/services/fileStorageService.js and frontend/dist only"
echo "Rollback copy: $BACKUP"
