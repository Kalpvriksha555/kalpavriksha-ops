#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

RELEASE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="${KALPA_LIVE_ROOT:-/var/www/kalpavriksha-ops}"
ENV_FILE="${KALPA_ENV_FILE:-/etc/kalpavriksha/backend.env}"
PM2_NAME="${KALPA_PM2_NAME:-kalpvriksha-backend}"
PORT="${PORT:-8080}"
DEPLOY_LOCK="${KALPA_DEPLOY_LOCK:-/run/lock/kalpavriksha-production-deploy.lock}"
CERTIFIED_COMMIT_FILE="${KALPA_CERTIFIED_COMMIT_FILE:-/root/kalpavriksha-certified-candidate.commit}"
CERTIFIED_RESULT_FILE="${KALPA_CERTIFIED_RESULT_FILE:-/root/kalpavriksha-certified-candidate.result.json}"
BACKUP_TIMER_UNITS=(kalpavriksha-backup.timer kalpavriksha-database-backup.timer)
ACTIVE_BACKUP_TIMERS=()
BACKUP_TIMERS_PAUSED=0
WORK="${KALPA_DEPLOY_WORK:-/root/kalpavriksha-1.9.30-deploy-$(date -u +%Y%m%dT%H%M%SZ)}"
ROLLBACK_ROOT="$WORK/previous-runtime"
ROLLBACK_CWD="$ROLLBACK_ROOT/backend"
ROLLBACK_SCRIPT=""
ENV_BACKUP="$WORK/backend.env.before"
CERTIFICATE_BACKUP="$WORK/release-certificate.before.json"
FRONTEND_BACKUP="$WORK/frontend-dist.before.tar.gz"
LIVE_SOURCE_ROLLBACK="$WORK/previous-live-source"

EXPECTED_ROOT_VERSION="1.9.30-runtime-persistence-recovery"
EXPECTED_BACKEND_VERSION="2.9.30-runtime-persistence-recovery"
EXPECTED_FRONTEND_VERSION="2.9.30-runtime-persistence-recovery"

BACKEND_STOPPED=0
DEPLOYMENT_COMPLETE=0
HAD_CERTIFICATE=0
HAD_FRONTEND_DIST=0
ROLLBACK_CAPTURED=0
LIVE_MUTATED=0


log() {
  printf '\n[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

fail() {
  echo "DEPLOYMENT FAILED: $*" >&2
  exit 1
}

resume_backup_timers() {
  if [[ "$BACKUP_TIMERS_PAUSED" != "1" ]]; then
    return 0
  fi
  if command -v systemctl >/dev/null 2>&1; then
    for unit in "${ACTIVE_BACKUP_TIMERS[@]}"; do
      systemctl start "$unit" >/dev/null 2>&1 || echo "WARNING: could not restart $unit" >&2
    done
  fi
  BACKUP_TIMERS_PAUSED=0
}

pause_backup_timers() {
  ACTIVE_BACKUP_TIMERS=()
  if command -v systemctl >/dev/null 2>&1; then
    for unit in "${BACKUP_TIMER_UNITS[@]}"; do
      if systemctl is-active --quiet "$unit" 2>/dev/null; then
        ACTIVE_BACKUP_TIMERS+=("$unit")
        systemctl stop "$unit"
      fi
    done
  fi
  BACKUP_TIMERS_PAUSED=1

  local backup_lock="${KALPA_BACKUP_ROOT}/.backup.lock"
  for _ in $(seq 1 450); do
    if [[ ! -e "$backup_lock" ]]; then
      return 0
    fi
    sleep 2
  done
  fail "An existing backup did not release $backup_lock within 15 minutes."
}

command -v flock >/dev/null || fail "flock is required for exclusive deployment locking."
mkdir -p "$(dirname "$DEPLOY_LOCK")"
exec 8>>"$DEPLOY_LOCK"
if ! flock -n 8; then
  fail "Another Kalpavriksha deployment is already running. Wait for it to finish; do not start a second deployment."
fi
printf 'pid=%s started=%s release=%s\n' "$$" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RELEASE_ROOT" >&8
mkdir -p "$WORK"
log "Exclusive deployment lock acquired: $DEPLOY_LOCK"

wait_for_health() {
  local endpoint="$1"
  local output="$2"
  local attempts="${3:-90}"
  for _ in $(seq 1 "$attempts"); do
    if curl --fail --silent --show-error --connect-timeout 2 --max-time 8 \
      "http://127.0.0.1:${PORT}${endpoint}" >"$output" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

restore_previous_runtime() {
  local rc=$?
  trap - ERR INT TERM EXIT

  if [[ "$DEPLOYMENT_COMPLETE" == "1" ]]; then
    exit 0
  fi

  if [[ "$ROLLBACK_CAPTURED" != "1" || "$LIVE_MUTATED" != "1" ]]; then
    resume_backup_timers
    echo "Deployment stopped before the live runtime was modified; the current PM2 runtime was left untouched." >&2
    exit "$rc"
  fi

  echo
  echo "======================================================"
  echo "DEPLOYMENT FAILED WITH CODE $rc"
  echo "Restoring the previous verified runtime..."
  echo "======================================================"

  if [[ -f "$ENV_BACKUP" ]]; then
    cp -a "$ENV_BACKUP" "$ENV_FILE"
  fi

  if [[ -d "$LIVE_SOURCE_ROLLBACK" ]]; then
    echo "Restoring the previous permanent live source tree..."
    rsync -a --delete "$LIVE_SOURCE_ROLLBACK/" "$LIVE/" \
      --exclude='.git/' \
      --exclude='node_modules/' \
      --exclude='backend/node_modules/' \
      --exclude='frontend/node_modules/' \
      --exclude='frontend/dist/' \
      --exclude='frontend/dist.next/' \
      --exclude='frontend/dist.previous/' \
      --exclude='.release/' \
      --exclude='release-certification.json' \
      --exclude='.env' \
      --exclude='backend/.env' \
      --exclude='backend/src/data/' \
      --exclude='backend/src/uploads/' \
      --exclude='backend/data/' \
      --exclude='backend/uploads/' \
      --exclude='data/' \
      --exclude='uploads/' \
      --exclude='private-files/' \
      --exclude='backups/' \
      --exclude='*.log' || true
    node "$RELEASE_ROOT/scripts/source-parity-clean.mjs" "$LIVE_SOURCE_ROLLBACK" "$LIVE" \
      >"$WORK/rollback-source-parity.json" 2>&1 || true
  fi

  if [[ "$HAD_CERTIFICATE" == "1" && -f "$CERTIFICATE_BACKUP" ]]; then
    mkdir -p "$(dirname "$RELEASE_CERTIFICATE_PATH")"
    cp -a "$CERTIFICATE_BACKUP" "$RELEASE_CERTIFICATE_PATH"
  elif [[ -n "${RELEASE_CERTIFICATE_PATH:-}" ]]; then
    rm -f "$RELEASE_CERTIFICATE_PATH"
  fi

  if [[ "$HAD_FRONTEND_DIST" == "1" && -f "$FRONTEND_BACKUP" ]]; then
    rm -rf "$LIVE/frontend/dist"
    mkdir -p "$LIVE/frontend"
    tar -C "$LIVE/frontend" -xzf "$FRONTEND_BACKUP"
  elif [[ "$HAD_FRONTEND_DIST" != "1" ]]; then
    rm -rf "$LIVE/frontend/dist"
  fi
  rm -rf "$LIVE/frontend/dist.next" "$LIVE/frontend/dist.previous"

  pm2 delete "$PM2_NAME" 2>/dev/null || true
  if [[ -n "$ROLLBACK_SCRIPT" && -f "$ROLLBACK_SCRIPT" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    pm2 start "$ROLLBACK_SCRIPT" --name "$PM2_NAME" --cwd "$ROLLBACK_CWD" --time --update-env || true
    wait_for_health "/api/health/live" "$WORK/rollback-live.json" 45 || true
    wait_for_health "/api/health/ready" "$WORK/rollback-ready.json" 45 || true
    pm2 save || true
  fi

  resume_backup_timers
  pm2 logs "$PM2_NAME" --lines 120 --nostream || true
  echo "Rollback records: $WORK"
  exit "$rc"
}
trap restore_previous_runtime ERR INT TERM EXIT

log "Validating release paths and required tools"
[[ "$RELEASE_ROOT" != "$LIVE" ]] || fail "Extract the release outside the live path before deployment."
[[ -d "$LIVE" ]] || fail "Live application directory is missing: $LIVE"
[[ -s "$ENV_FILE" ]] || fail "Production environment file is missing: $ENV_FILE"
for command_name in git node npm pm2 curl rsync python3 tar sha256sum sed grep find flock tr seq realpath bash; do
  command -v "$command_name" >/dev/null || fail "$command_name is missing"
done

log "Re-verifying exact isolated candidate authorization inside the deployment script"
[[ -d "$RELEASE_ROOT/.git" ]] || fail "Deployment release root must remain the exact certified Git checkout."
[[ -s "$CERTIFIED_COMMIT_FILE" ]] || fail "Candidate certification commit receipt is missing."
[[ -s "$CERTIFIED_RESULT_FILE" ]] || fail "Candidate certification result receipt is missing."
CURRENT_COMMIT="$(git -C "$RELEASE_ROOT" rev-parse HEAD)"
CERTIFIED_COMMIT="$(tr -d '[:space:]' < "$CERTIFIED_COMMIT_FILE")"
[[ "$CURRENT_COMMIT" == "$CERTIFIED_COMMIT" ]] || fail "Release commit $CURRENT_COMMIT is not the certified commit $CERTIFIED_COMMIT."
[[ -z "$(git -C "$RELEASE_ROOT" -c core.fileMode=false status --porcelain --untracked-files=no)" ]] || fail "Certified release has tracked source changes; refusing deployment."
python3 - "$CERTIFIED_RESULT_FILE" "$CURRENT_COMMIT" <<'PY'
import json,sys
p=json.load(open(sys.argv[1])); commit=sys.argv[2]
if p.get('ok') is not True or p.get('status')!='CERTIFIED_FOR_GUARDED_DEPLOYMENT' or str(p.get('commit') or '')!=commit:
    raise SystemExit('candidate certification receipt does not authorize this exact commit')
e=p.get('e2e') or {}
for key in ('downloadHashMatched','staleOptimisticIdResolvedToCanonicalTask','wrongTaskAttachmentPrevented'):
    if e.get(key) is not True:
        raise SystemExit(f'candidate receipt is missing required E2E proof: {key}')
PY
REMOTE_COMMIT="$(git -C "$RELEASE_ROOT" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
[[ "$REMOTE_COMMIT" == "$CURRENT_COMMIT" ]] || fail "GitHub main moved after certification. Re-certification is required."

ROOT_VERSION="$(node -e "console.log(require(process.argv[1]).version)" "$RELEASE_ROOT/package.json")"
BACKEND_VERSION="$(node -e "console.log(require(process.argv[1]).version)" "$RELEASE_ROOT/backend/package.json")"
FRONTEND_VERSION="$(node -e "console.log(require(process.argv[1]).version)" "$RELEASE_ROOT/frontend/package.json")"
[[ "$ROOT_VERSION" == "$EXPECTED_ROOT_VERSION" ]] || fail "Unexpected root version: $ROOT_VERSION"
[[ "$BACKEND_VERSION" == "$EXPECTED_BACKEND_VERSION" ]] || fail "Unexpected backend version: $BACKEND_VERSION"
[[ "$FRONTEND_VERSION" == "$EXPECTED_FRONTEND_VERSION" ]] || fail "Unexpected frontend version: $FRONTEND_VERSION"

for marker in \
  RELATIONAL_SHADOW_HASH_DIVERGENCE \
  RELATIONAL_SELECTED_COLLECTION_MISMATCH \
  RELATIONAL_METADATA_COMPARE_AND_SWAP_FAILED \
  PRESENCE_PERSISTENCE_DEFERRED \
  startup_integrity_verified; do
  grep -Rqs "$marker" "$RELEASE_ROOT/backend/src" || fail "Required hardening marker is missing: $marker"
done
! grep -Rqs 'KALPA_PRESENCE_WRITE_FAILSAFE_V1' "$RELEASE_ROOT/backend/src" || fail "Temporary presence bypass remains in release source."
! grep -Rqs 'KALPA_DISABLE_AUTO_PRESENCE_WRITES' "$RELEASE_ROOT/backend/src" || fail "Temporary presence-disable setting remains in release source."

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export PORT="${PORT:-8080}"
export BIND_HOST="0.0.0.0"
export VITE_API_URL="${VITE_API_URL:-https://api.kalpvriksha.co.in}"
export npm_config_registry="https://registry.npmjs.org/"
: "${DATABASE_URL:?DATABASE_URL is missing from $ENV_FILE}"
: "${KALPA_BACKUP_ROOT:?KALPA_BACKUP_ROOT is missing from $ENV_FILE}"
: "${RELEASE_CERTIFICATE_PATH:?RELEASE_CERTIFICATE_PATH is missing from $ENV_FILE}"

log "Capturing the currently running backend for immutable rollback"
OLD_SCRIPT="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);if(!p)process.exit(2);process.stdout.write(p.pm2_env.pm_exec_path||'');});" "$PM2_NAME")"
OLD_CWD="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);if(!p)process.exit(2);process.stdout.write(p.pm2_env.pm_cwd||'');});" "$PM2_NAME")"
[[ -f "$OLD_SCRIPT" ]] || fail "Current PM2 backend script could not be identified."
[[ -d "$OLD_CWD" ]] || fail "Current PM2 working directory could not be identified."
OLD_RELATIVE_SCRIPT="$(python3 - "$OLD_CWD" "$OLD_SCRIPT" <<'PY'
import os,sys
cwd=os.path.realpath(sys.argv[1]); script=os.path.realpath(sys.argv[2])
relative=os.path.relpath(script,cwd)
if relative == '..' or relative.startswith('../'): raise SystemExit(2)
print(relative)
PY
)" || fail "Current PM2 script is outside its working directory."
rm -rf "$ROLLBACK_ROOT"
mkdir -p "$ROLLBACK_CWD"
cp -a "$OLD_CWD/." "$ROLLBACK_CWD/"
ROLLBACK_SCRIPT="$ROLLBACK_CWD/$OLD_RELATIVE_SCRIPT"
node --check "$ROLLBACK_SCRIPT"
cp -a "$ENV_FILE" "$ENV_BACKUP"
if [[ -f "$RELEASE_CERTIFICATE_PATH" ]]; then
  cp -a "$RELEASE_CERTIFICATE_PATH" "$CERTIFICATE_BACKUP"
  HAD_CERTIFICATE=1
fi
if [[ -d "$LIVE/frontend/dist" ]]; then
  tar -C "$LIVE/frontend" -czf "$FRONTEND_BACKUP" dist
  HAD_FRONTEND_DIST=1
fi

log "Capturing the permanent live source tree for full rollback parity"
rm -rf "$LIVE_SOURCE_ROLLBACK"
mkdir -p "$LIVE_SOURCE_ROLLBACK"
rsync -a "$LIVE/" "$LIVE_SOURCE_ROLLBACK/" \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='backend/node_modules/' \
  --exclude='frontend/node_modules/' \
  --exclude='frontend/dist/' \
  --exclude='frontend/dist.next/' \
  --exclude='frontend/dist.previous/' \
  --exclude='.release/' \
  --exclude='release-certification.json' \
  --exclude='.env' \
  --exclude='backend/.env' \
  --exclude='backend/src/data/' \
  --exclude='backend/src/uploads/' \
  --exclude='backend/data/' \
  --exclude='backend/uploads/' \
  --exclude='data/' \
  --exclude='uploads/' \
  --exclude='private-files/' \
  --exclude='backups/' \
  --exclude='*.log'
ROLLBACK_CAPTURED=1

log "Removing obsolete live-source artifacts from the release package"
rm -f "$RELEASE_ROOT/backend/FETCH_HEAD"
find "$RELEASE_ROOT" -type f -name 'server.js.before-presence-failsafe-*' -delete
rm -rf "$RELEASE_ROOT/node_modules" "$RELEASE_ROOT/backend/node_modules" "$RELEASE_ROOT/frontend/node_modules" \
  "$RELEASE_ROOT/frontend/dist" "$RELEASE_ROOT/.release" "$RELEASE_ROOT/release-certification.json"

log "Preserving the exact certified GitHub commit as the immutable release identity"
[[ "$(git -C "$RELEASE_ROOT" rev-parse HEAD)" == "$CURRENT_COMMIT" ]] || fail "Release Git identity changed unexpectedly."
[[ -z "$(git -C "$RELEASE_ROOT" -c core.fileMode=false status --porcelain --untracked-files=no)" ]] || fail "Tracked release source changed before dependency installation."

log "Installing isolated release dependencies"
cd "$RELEASE_ROOT"
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm ci --prefix backend --no-audit --no-fund
npm ci --prefix frontend --include=dev --no-audit --no-fund

log "Running source security, syntax, regression, backend, frontend and build verification"
npm run verify
node --check backend/src/server.js
node --check backend/src/repositories/postgresStateRepository.js
node --check backend/src/services/operationalReliabilityService.js
bash -n scripts/deploy-1.9.30-vps.sh
node --check backend/scripts/backup-create.mjs

log "Running clean-install verification against the exact source tree"
npm run release:clean-install
[[ -z "$(git -C "$RELEASE_ROOT" -c core.fileMode=false status --porcelain --untracked-files=no)" ]] || fail "Verification modified tracked source; deployment is blocked."
[[ "$(git -C "$RELEASE_ROOT" rev-parse HEAD)" == "$CURRENT_COMMIT" ]] || fail "Certified Git commit changed during verification."

log "Pausing automatic backup timers and waiting for any in-flight backup"
pause_backup_timers

log "Stopping application writes for exact backup and database gates"
LIVE_MUTATED=1
pm2 stop "$PM2_NAME"
BACKEND_STOPPED=1

log "Creating and verifying an exact pre-deployment backup"
npm run backup:create | tee "$WORK/pre-deployment-backup.json"
npm run backup:verify | tee "$WORK/pre-deployment-backup-verification.json"
npm run backup:status | tee "$WORK/pre-deployment-backup-status.json"

log "Applying schema migrations and enforcing strict relational integrity"
npm run db:migrate --prefix backend
npm run db:integrity --prefix backend | tee "$WORK/pre-deployment-integrity.json"

log "Removing the obsolete emergency presence-disable setting"
sed -i '/^[[:space:]]*KALPA_DISABLE_AUTO_PRESENCE_WRITES[[:space:]]*=/d' "$ENV_FILE"
unset KALPA_DISABLE_AUTO_PRESENCE_WRITES

log "Certifying the exact production release"
rm -rf "$RELEASE_ROOT/frontend/dist"
rm -f "$RELEASE_CERTIFICATE_PATH"
npm run release:certify | tee "$WORK/release-certification.json"
npm run release:gate | tee "$WORK/release-gate.json"
[[ -s "$RELEASE_ROOT/frontend/dist/index.html" ]] || fail "Certified frontend build is missing."

log "Starting the certified release from its isolated staging path"
pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start "$RELEASE_ROOT/backend/src/server.js" --name "$PM2_NAME" --cwd "$RELEASE_ROOT/backend" --time --update-env
wait_for_health "/api/health/live" "$WORK/staging-live.json" || fail "Staging backend liveness failed."
wait_for_health "/api/health/ready" "$WORK/staging-ready.json" || fail "Staging backend readiness failed."
BACKEND_STOPPED=0

log "Synchronizing the exact certified source to the permanent live path"
rsync -a --delete "$RELEASE_ROOT/" "$LIVE/" \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='backend/node_modules/' \
  --exclude='frontend/node_modules/' \
  --exclude='frontend/dist/' \
  --exclude='.release/' \
  --exclude='release-certification.json' \
  --exclude='.env' \
  --exclude='backend/.env' \
  --exclude='backend/src/data/' \
  --exclude='backend/src/uploads/' \
  --exclude='backend/data/' \
  --exclude='backend/uploads/' \
  --exclude='data/' \
  --exclude='uploads/' \
  --exclude='private-files/' \
  --exclude='backups/' \
  --exclude='*.log'

log "Removing stale non-runtime live-source artifacts and proving source parity"
node "$RELEASE_ROOT/scripts/source-parity-clean.mjs" "$RELEASE_ROOT" "$LIVE" | tee "$WORK/permanent-source-parity.json"

log "Installing production backend dependencies at the permanent path"
rm -rf "$LIVE/backend/node_modules"
npm ci --prefix "$LIVE/backend" --omit=dev --no-audit --no-fund
node --check "$LIVE/backend/src/server.js"

log "Verifying the permanent live source against the release certificate before build-artifact switching"
cd "$LIVE"
npm run release:gate | tee "$WORK/permanent-live-release-gate.before-frontend-switch.json"

log "Preparing an atomic frontend build switch"
rm -rf "$LIVE/frontend/dist.next" "$LIVE/frontend/dist.previous"
cp -a "$RELEASE_ROOT/frontend/dist" "$LIVE/frontend/dist.next"
if [[ -d "$LIVE/frontend/dist" ]]; then mv "$LIVE/frontend/dist" "$LIVE/frontend/dist.previous"; fi
mv "$LIVE/frontend/dist.next" "$LIVE/frontend/dist"

log "Re-verifying the permanent source after the atomic frontend switch"
cd "$LIVE"
npm run release:gate | tee "$WORK/permanent-live-release-gate.after-frontend-switch.json"

log "Switching PM2 to the permanent live backend"
pm2 delete "$PM2_NAME" 2>/dev/null || true
pm2 start "$LIVE/backend/src/server.js" --name "$PM2_NAME" --cwd "$LIVE/backend" --time --update-env
wait_for_health "/api/health/live" "$WORK/live.json" || fail "Permanent backend liveness failed."
wait_for_health "/api/health/ready" "$WORK/ready.json" || fail "Permanent backend readiness failed."
pm2 save

log "Running final database integrity and public runtime health checks"
# Database integrity is verified directly against PostgreSQL with the production environment.
# /api/db/health is intentionally admin-protected and must never be used as an anonymous deployment probe.
npm run db:integrity --prefix backend | tee "$WORK/post-deployment-integrity.json"
curl -fsS "http://127.0.0.1:${PORT}/api/health/live" | tee "$WORK/final-live.json"
echo
curl -fsS "http://127.0.0.1:${PORT}/api/health/ready" | tee "$WORK/final-ready.json"
echo

log "Creating and verifying the first post-deployment backup"
npm run backup:create | tee "$WORK/post-deployment-backup.json"
npm run backup:verify | tee "$WORK/post-deployment-backup-verification.json"
npm run backup:status | tee "$WORK/post-deployment-backup-status.json"

log "Restoring automatic backup timers"
resume_backup_timers

rm -rf "$LIVE/frontend/dist.previous"
DEPLOYMENT_COMPLETE=1
trap - ERR INT TERM EXIT

log "Deployment completed"
echo "======================================================"
echo "KALPAVRIKSHA 1.9.30 DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "======================================================"
echo "Exclusive production deployment lock: active"
echo "Backup timer collision guard: active"
echo "Converged private-file snapshot backup: active"
echo "Permanent selected-row integrity fix: active"
echo "Automatic presence writes: active"
echo "Emergency presence bypass: removed"
echo "PostgreSQL physical read-back hashing: active"
echo "Metadata compare-and-swap: active"
echo "Stale persistence failures: resolved after verified startup"
echo "Deployment records: $WORK"
echo "Rollback runtime retained: $ROLLBACK_ROOT"
echo "======================================================"
