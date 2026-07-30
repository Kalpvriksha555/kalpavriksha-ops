#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-recover-deploy}"
LIVE="/var/www/kalpavriksha-ops"
STAGE="/var/www/kalpavriksha-july30-safe"
ENV_FILE="/etc/kalpavriksha/backend.env"
WORK="/root/kalpavriksha-july30-safe"
RECOVERY_EXPORT="$WORK/july30-project-operations-export.json"
RELEASE_BRANCH="july30-safe-release"
PM2_NAME="kalpvriksha-backend"
EXPECTED_ROOT_VERSION="1.9.8-july30-safe-recovery"
EXPECTED_BACKEND_VERSION="2.9.8-july30-safe-recovery"

log() { printf '\n[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

require_common() {
  test -d "$LIVE/.git" || fail "Live Git repository is missing: $LIVE"
  test -s "$ENV_FILE" || fail "Production environment file is missing: $ENV_FILE"
  command -v git >/dev/null
  command -v node >/dev/null
  command -v npm >/dev/null
  command -v pm2 >/dev/null
  command -v curl >/dev/null
  command -v tar >/dev/null
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  : "${DATABASE_URL:?DATABASE_URL is missing from $ENV_FILE}"
  : "${KALPA_BACKUP_ROOT:?KALPA_BACKUP_ROOT is missing from $ENV_FILE}"
  export PORT="${PORT:-8080}"
}

validate_source() {
  local source="$1"
  test -f "$source/backend/src/server.js" || fail "Backend entrypoint is missing from $source"
  local root_version backend_version commit
  root_version="$(node -p "require('$source/package.json').version")"
  backend_version="$(node -p "require('$source/backend/package.json').version")"
  commit="$(git -C "$source" rev-parse HEAD)"
  echo "Source commit:   $commit"
  echo "Root version:    $root_version"
  echo "Backend version: $backend_version"
  test "$root_version" = "$EXPECTED_ROOT_VERSION" || fail "Unexpected root version: $root_version"
  test "$backend_version" = "$EXPECTED_BACKEND_VERSION" || fail "Unexpected backend version: $backend_version"
  test -n "${EXPECTED_COMMIT:-}" || fail "EXPECTED_COMMIT is required"
  test "$commit" = "$EXPECTED_COMMIT" || fail "Source commit $commit does not match $EXPECTED_COMMIT"
}

prepare_stage() {
  log "Fetching the July 30 safe release"
  git -C "$LIVE" fetch origin "$RELEASE_BRANCH"
  git -C "$LIVE" worktree remove "$STAGE" --force 2>/dev/null || true
  test "$STAGE" != "/" && test "$STAGE" != "$LIVE" || fail "Unsafe staging path"
  rm -rf "$STAGE"
  git -C "$LIVE" worktree prune
  git -C "$LIVE" worktree add --detach "$STAGE" "origin/$RELEASE_BRANCH"
  validate_source "$STAGE"

  log "Installing clean dependencies"
  cd "$STAGE"
  rm -rf node_modules backend/node_modules frontend/node_modules frontend/dist .release release-certification.json
  npm ci --include=dev --no-audit --no-fund
  npm ci --prefix frontend --include=dev --no-audit --no-fund

  log "Running the complete verification suite"
  npm run verify
  rm -rf frontend/dist .release release-certification.json
  npm run release:clean-install
}

create_backup_bundle() {
  local label="$1"
  local source="$2"
  local output_json="$WORK/${label}-backup.json"
  local output_tar="$WORK/${label}-backup.tar"
  cd "$source"
  node backend/scripts/backup-create.mjs >"$output_json"
  local manifest
  manifest="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(!j.ok||j.status!=='VERIFIED')process.exit(2);process.stdout.write(j.manifestPath)" "$output_json")"
  node backend/scripts/backup-verify.mjs "$manifest" >"$WORK/${label}-backup-verify.json"
  local backup_root prefix base
  backup_root="$(dirname "$manifest")"
  prefix="${manifest%.manifest.json}"
  base="$(basename "$prefix")"
  local names=("${base}.manifest.json")
  test -f "${prefix}.postgres.dump" && names+=("${base}.postgres.dump")
  test -f "${prefix}.files.tar.gz" && names+=("${base}.files.tar.gz")
  tar -cf "$output_tar" -C "$backup_root" "${names[@]}"
  echo "$manifest"
}

wait_for_health() {
  local path="$1"
  local output="$2"
  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:${PORT}${path}" >"$output" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

recover_and_deploy() {
  require_common
  load_env
  test -s "$RECOVERY_EXPORT" || fail "July 30 recovery export is missing: $RECOVERY_EXPORT"
  install -d -m 700 "$WORK"
  prepare_stage

  log "Creating a verified pre-recovery database and private-file backup"
  create_backup_bundle "pre-recovery" "$STAGE"

  local old_script old_cwd recovery_applied=0 service_stopped=0
  old_script="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);if(!p)process.exit(2);process.stdout.write(p.pm2_env.pm_exec_path||'')})" "$PM2_NAME")"
  old_cwd="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);if(!p)process.exit(2);process.stdout.write(p.pm2_env.pm_cwd||'')})" "$PM2_NAME")"
  test -f "$old_script" || fail "Could not resolve the current backend script"

  rollback_service() {
    local rc=$?
    trap - ERR INT TERM
    echo "Recovery/deployment failed with exit $rc."
    if [ "$service_stopped" = "1" ]; then
      pm2 delete "$PM2_NAME" 2>/dev/null || true
      pm2 start "$old_script" --name "$PM2_NAME" --cwd "$old_cwd" --time --update-env || true
      pm2 save || true
    fi
    if [ "$recovery_applied" = "1" ]; then
      echo "The recovery transaction passed its own post-write checks and was retained; the previous backend was restored."
    fi
    exit "$rc"
  }
  trap rollback_service ERR INT TERM

  log "Stopping application writes"
  pm2 stop "$PM2_NAME"
  service_stopped=1

  cd "$STAGE"
  log "Planning recovery against the stopped live database"
  node backend/scripts/july30-recovery.mjs \
    --mode=plan \
    --source="$RECOVERY_EXPORT" \
    --report="$WORK/july30-recovery-plan.json"

  log "Applying the timestamp-aware project and operations merge"
  node backend/scripts/july30-recovery.mjs \
    --mode=apply \
    --source="$RECOVERY_EXPORT" \
    --report="$WORK/july30-recovery-report.json"
  recovery_applied=1

  log "Certifying the exact release against recovered production data"
  rm -f /var/lib/kalpavriksha/release-certification.json
  npm run release:certify
  npm run release:gate

  log "Starting the verified release"
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  pm2 start "$STAGE/backend/src/server.js" --name "$PM2_NAME" --cwd "$STAGE/backend" --time --update-env
  wait_for_health "/api/health/live" "$WORK/live-health.json" || fail "Backend liveness failed"
  wait_for_health "/api/health/ready" "$WORK/ready-health.json" || fail "Backend readiness failed"
  pm2 save
  service_stopped=0

  log "Creating a verified post-recovery backup"
  create_backup_bundle "post-recovery" "$STAGE"

  trap - ERR INT TERM
  echo "JULY 30 DATA RECOVERY AND HARDENED DEPLOYMENT COMPLETED SUCCESSFULLY"
}

align_main() {
  require_common
  load_env
  validate_source "$STAGE"
  log "Aligning the normal live checkout to verified GitHub main"
  git -C "$LIVE" fetch origin main
  git -C "$LIVE" reset --hard origin/main
  test "$(git -C "$LIVE" rev-parse HEAD)" = "$EXPECTED_COMMIT" || fail "GitHub main does not match the verified commit"
  cd "$LIVE"
  rm -rf backend/node_modules
  npm ci --prefix backend --omit=dev --no-audit --no-fund

  pm2 stop "$PM2_NAME"
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  pm2 start "$LIVE/backend/src/server.js" --name "$PM2_NAME" --cwd "$LIVE/backend" --time --update-env
  if ! wait_for_health "/api/health/live" "$WORK/main-live-health.json" || ! wait_for_health "/api/health/ready" "$WORK/main-ready-health.json"; then
    pm2 delete "$PM2_NAME" 2>/dev/null || true
    pm2 start "$STAGE/backend/src/server.js" --name "$PM2_NAME" --cwd "$STAGE/backend" --time --update-env
    pm2 save
    fail "Main-path backend failed; the verified staging backend was restored"
  fi
  pm2 save
  echo "VERIFIED GITHUB MAIN AND VPS ARE ALIGNED"
}

case "$MODE" in
  recover-deploy) recover_and_deploy ;;
  align-main) align_main ;;
  *) fail "Unknown mode: $MODE" ;;
esac

