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
  export BIND_HOST="0.0.0.0"
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
  local desired_commit stage_commit verified_commit
  desired_commit="$(git -C "$LIVE" rev-parse "origin/$RELEASE_BRANCH")"
  test "$desired_commit" = "${EXPECTED_COMMIT:-}" || fail "Fetched release does not match EXPECTED_COMMIT"
  stage_commit="$(git -C "$STAGE" rev-parse HEAD 2>/dev/null || true)"
  verified_commit="$(cat "$WORK/verified-stage-commit" 2>/dev/null || true)"
  if [ "$stage_commit" = "$desired_commit" ] &&
     [ "$verified_commit" = "$desired_commit" ] &&
     [ -d "$STAGE/node_modules" ] &&
     [ -d "$STAGE/backend/node_modules" ]; then
    log "Reusing the already verified staging release $desired_commit"
    validate_source "$STAGE"
    return
  fi

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
  printf '%s' "$desired_commit" >"$WORK/verified-stage-commit"
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

install_backup_timers() {
  local units="$LIVE/docs/deployment/systemd"
  for unit in \
    kalpavriksha-backup.service \
    kalpavriksha-backup.timer \
    kalpavriksha-database-backup.service \
    kalpavriksha-database-backup.timer \
    kalpavriksha-backup-status.service \
    kalpavriksha-backup-status.timer; do
    test -s "$units/$unit" || fail "Backup systemd unit is missing: $unit"
    install -m 0644 "$units/$unit" "/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
  systemctl enable --now \
    kalpavriksha-backup.timer \
    kalpavriksha-database-backup.timer \
    kalpavriksha-backup-status.timer
  systemctl start kalpavriksha-backup-status.service
  systemctl is-active --quiet kalpavriksha-backup.timer
  systemctl is-active --quiet kalpavriksha-database-backup.timer
  systemctl is-active --quiet kalpavriksha-backup-status.timer
  systemctl list-timers \
    kalpavriksha-backup.timer \
    kalpavriksha-database-backup.timer \
    kalpavriksha-backup-status.timer \
    --no-pager >"$WORK/backup-timers.txt"
}

recover_and_deploy() {
  require_common
  load_env
  test -s "$RECOVERY_EXPORT" || fail "July 30 recovery export is missing: $RECOVERY_EXPORT"
  install -d -m 700 "$WORK"
  prepare_stage

  local completed_commit current_script
  completed_commit="$(cat "$WORK/recovery-deploy-complete" 2>/dev/null || true)"
  current_script="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);process.stdout.write(p?.pm2_env?.pm_exec_path||'')})" "$PM2_NAME")"
  if [ "$completed_commit" = "${EXPECTED_COMMIT:-}" ] &&
     [ "$current_script" = "$STAGE/backend/src/server.js" ] &&
     wait_for_health "/api/health/live" "$WORK/live-health.json" &&
     wait_for_health "/api/health/ready" "$WORK/ready-health.json"; then
    echo "JULY 30 RECOVERY AND DEPLOYMENT WERE ALREADY VERIFIED FOR $completed_commit"
    return
  fi

  cd "$STAGE"
  log "Running a read-only recovery preflight while the current service remains online"
  node backend/scripts/july30-recovery.mjs \
    --mode=plan \
    --source="$RECOVERY_EXPORT" \
    --report="$WORK/july30-recovery-preflight.json"

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
  local applied_commit
  applied_commit="$(cat "$WORK/recovery-applied-commit" 2>/dev/null || true)"
  if [ "$applied_commit" = "${EXPECTED_COMMIT:-}" ] &&
     node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(!r.ok||r.mode!=='apply'||!r.verification?.ok)process.exit(1)" "$WORK/july30-recovery-report.json"; then
    log "Reusing the already verified recovery transaction for $applied_commit"
    recovery_applied=1
  else
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
    printf '%s' "$EXPECTED_COMMIT" >"$WORK/recovery-applied-commit"
  fi

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

  printf '%s' "$EXPECTED_COMMIT" >"$WORK/recovery-deploy-complete"
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
  test -s "$STAGE/frontend/dist/index.html" || fail "Verified frontend build is missing from staging"
  rm -rf "$LIVE/frontend/dist.next" "$LIVE/frontend/dist.previous"
  cp -a "$STAGE/frontend/dist" "$LIVE/frontend/dist.next"
  if [ -d "$LIVE/frontend/dist" ]; then mv "$LIVE/frontend/dist" "$LIVE/frontend/dist.previous"; fi
  mv "$LIVE/frontend/dist.next" "$LIVE/frontend/dist"

  pm2 stop "$PM2_NAME"
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  pm2 start "$LIVE/backend/src/server.js" --name "$PM2_NAME" --cwd "$LIVE/backend" --time --update-env
  if ! wait_for_health "/api/health/live" "$WORK/main-live-health.json" || ! wait_for_health "/api/health/ready" "$WORK/main-ready-health.json"; then
    pm2 delete "$PM2_NAME" 2>/dev/null || true
    pm2 start "$STAGE/backend/src/server.js" --name "$PM2_NAME" --cwd "$STAGE/backend" --time --update-env
    rm -rf "$LIVE/frontend/dist"
    if [ -d "$LIVE/frontend/dist.previous" ]; then mv "$LIVE/frontend/dist.previous" "$LIVE/frontend/dist"; fi
    pm2 save
    fail "Main-path backend failed; the verified staging backend was restored"
  fi
  rm -rf "$LIVE/frontend/dist.previous"
  pm2 save
  install_backup_timers
  printf '%s' "$EXPECTED_COMMIT" >"$WORK/main-align-complete"
  echo "VERIFIED GITHUB MAIN AND VPS ARE ALIGNED"
}

final_merge_and_deploy() {
  require_common
  load_env
  install -d -m 700 "$WORK"
  prepare_stage

  cd "$STAGE"
  log "Preflighting the final active-plus-recovered merge while the stable service remains online"
  node backend/scripts/july30-finalize.mjs \
    --mode=plan \
    --report="$WORK/july30-final-preflight.json"

  log "Creating a verified backup containing both active legacy and recovered relational states"
  create_backup_bundle "pre-final-merge" "$STAGE"

  local old_script old_cwd merge_applied=0 service_stopped=0
  old_script="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);if(!p)process.exit(2);process.stdout.write(p.pm2_env.pm_exec_path||'')})" "$PM2_NAME")"
  old_cwd="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);if(!p)process.exit(2);process.stdout.write(p.pm2_env.pm_cwd||'')})" "$PM2_NAME")"
  test -f "$old_script" || fail "Could not resolve the current stable backend script"

  rollback_final_service() {
    local rc="${1:-$?}"
    trap - ERR INT TERM
    echo "Final merge/deployment stopped with exit $rc."
    if [ "$service_stopped" = "1" ]; then
      pm2 delete "$PM2_NAME" 2>/dev/null || true
      pm2 start "$old_script" --name "$PM2_NAME" --cwd "$old_cwd" --time --update-env || true
      pm2 save || true
    fi
    if [ "$merge_applied" = "1" ]; then
      echo "The verified final merge was retained; the previous stable backend was restored."
    fi
    exit "$rc"
  }
  trap rollback_final_service ERR INT TERM

  log "Stopping writes for the authoritative final merge"
  pm2 stop "$PM2_NAME"
  service_stopped=1

  log "Replanning against the stopped active state"
  node backend/scripts/july30-finalize.mjs \
    --mode=plan \
    --report="$WORK/july30-final-plan.json"

  log "Applying and verifying the final dual-state merge"
  node backend/scripts/july30-finalize.mjs \
    --mode=apply \
    --report="$WORK/july30-final-report.json"
  merge_applied=1

  log "Certifying the release against the final merged production database"
  rm -f /var/lib/kalpavriksha/release-certification.json
  npm run release:certify
  npm run release:gate
  cp "$RELEASE_CERTIFICATE_PATH" "$WORK/final-release-certification.json"

  log "Starting the final release on an explicit production bind address"
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  pm2 start "$STAGE/backend/src/server.js" --name "$PM2_NAME" --cwd "$STAGE/backend" --time --update-env
  if ! wait_for_health "/api/health/live" "$WORK/live-health.json"; then rollback_final_service 1; fi
  if ! wait_for_health "/api/health/ready" "$WORK/ready-health.json"; then rollback_final_service 1; fi
  pm2 save
  service_stopped=0

  log "Creating the verified post-final-merge backup"
  create_backup_bundle "post-final-merge" "$STAGE"
  printf '%s' "$EXPECTED_COMMIT" >"$WORK/final-merge-deploy-complete"
  trap - ERR INT TERM
  echo "FINAL JULY 30 MERGE AND VERIFIED RELEASE DEPLOYMENT COMPLETED SUCCESSFULLY"
}

restore_stable_live() {
  require_common
  load_env
  local stable_script="$LIVE/backend/src/server.js"
  local stable_cwd="$LIVE/backend"
  test -f "$stable_script" || fail "Stable backend entrypoint is missing: $stable_script"

  log "Restoring the known stable live backend without changing recovery data"
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  pm2 start "$stable_script" --name "$PM2_NAME" --cwd "$stable_cwd" --time --update-env
  if ! wait_for_health "/api/health" "$WORK/stable-live-health.json"; then
    pm2 logs "$PM2_NAME" --lines 120 --nostream || true
    fail "Stable backend health check failed"
  fi
  pm2 save

  log "Preserving the dormant recovered database in a verified backup"
  if [ -d "$STAGE/backend/node_modules" ] && create_backup_bundle "deferred-recovery" "$STAGE"; then
    echo "Recovered relational state was backed up for a later maintenance window."
  else
    echo "WARNING: Deferred recovery backup could not be refreshed; earlier verified server and local backups remain available." >&2
  fi

  date -u +%Y-%m-%dT%H:%M:%SZ >"$WORK/recovery-deferred-at"
  echo "STABLE LIVE BACKEND RESTORED; JULY 30 RECOVERY IS DEFERRED"
  cat "$WORK/stable-live-health.json"
}

case "$MODE" in
  recover-deploy) recover_and_deploy ;;
  final-merge-deploy) final_merge_and_deploy ;;
  align-main) align_main ;;
  restore-stable) restore_stable_live ;;
  *) fail "Unknown mode: $MODE" ;;
esac
