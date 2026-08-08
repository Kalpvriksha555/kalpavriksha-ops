#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

RELEASE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_ROOT="${KALPA_LIVE_ROOT:-/var/www/kalpavriksha-ops}"
ENV_FILE="${KALPA_ENV_FILE:-/etc/kalpavriksha/backend.env}"
API_URL="${VITE_API_URL:-https://api.kalpvriksha.co.in}"
PUBLIC_FRONTEND_URL="${KALPA_PUBLIC_FRONTEND_URL:-https://ops.kalpvriksha.co.in/}"
PUBLIC_API_URL="${KALPA_PUBLIC_API_URL:-https://api.kalpvriksha.co.in}"
LOCAL_PG_PORT="${KALPA_TEMP_PG_PORT:-55432}"
CERT_PORT="${KALPA_CERT_PORT:-18080}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PGROOT="/var/tmp/kalpavriksha-final-pg-${STAMP}"
PGDATA="$PGROOT/data"
PGSOCKET="$PGROOT/socket"
POLICY_FILE="/usr/sbin/policy-rc.d"
POLICY_BACKUP="/var/tmp/kalpavriksha-policy-rc.d-${STAMP}"
POLICY_MOVED=0
TEMP_PG_STARTED=0
DEPLOY_STARTED=0
DEPLOY_UNIT=""
EXPECTED_COMMIT=""

say(){ printf '\n[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fail(){ printf '\nFINAL RELEASE STOPPED SAFELY: %s\n' "$*" >&2; exit 1; }
restore_policy_guard(){
  if [[ "$POLICY_MOVED" == "1" ]]; then rm -f "$POLICY_FILE"; mv -f "$POLICY_BACKUP" "$POLICY_FILE"; POLICY_MOVED=0;
  elif [[ -f "$POLICY_FILE" ]] && grep -q 'KALPAVRIKSHA_TEMP_NO_SERVICE_START' "$POLICY_FILE" 2>/dev/null; then rm -f "$POLICY_FILE"; fi
}
stop_temp_postgres(){
  set +e
  if [[ "$TEMP_PG_STARTED" == "1" && -n "${PG_CTL:-}" && -x "${PG_CTL:-}" ]]; then runuser -u postgres -- "$PG_CTL" -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 || true; TEMP_PG_STARTED=0; fi
  rm -rf "$PGROOT"
  set -e
}
cleanup(){
  local rc=$?; set +e; stop_temp_postgres; restore_policy_guard
  if (( rc != 0 )); then
    if [[ "$DEPLOY_STARTED" == "0" ]]; then printf '\nProduction deployment was NOT started.\n' >&2; else printf '\nDeployment unit: %s\nThe production deployer owns rollback if live mutation began.\n' "$DEPLOY_UNIT" >&2; fi
  fi
  return "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ "$(id -u)" == "0" ]] || fail "Run as root on the VPS."
[[ -d "$RELEASE_ROOT/.git" ]] || fail "Run from a fresh Git checkout."
[[ "$(realpath -m "$RELEASE_ROOT")" != "$(realpath -m "$LIVE_ROOT")" ]] || fail "Never certify/deploy from the live source path."
[[ -s "$ENV_FILE" ]] || fail "Production environment file is missing: $ENV_FILE"
for tool in git curl node npm python3 awk sed grep df find sort tail sha256sum flock runuser ss apt-get apt-cache systemctl systemd-run journalctl pm2 realpath stat tr seq bash install head cut wc chmod chown mkdir rm mv cat cp tee sleep date; do command -v "$tool" >/dev/null 2>&1 || fail "Required VPS command is missing: $tool"; done

say "Freezing the exact GitHub commit and proving the candidate is clean"
EXPECTED_COMMIT="$(git -C "$RELEASE_ROOT" rev-parse HEAD)"
REMOTE_COMMIT="$(git -C "$RELEASE_ROOT" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
[[ -n "$REMOTE_COMMIT" && "$EXPECTED_COMMIT" == "$REMOTE_COMMIT" ]] || fail "Candidate is not current GitHub main."
[[ -z "$(git -C "$RELEASE_ROOT" -c core.fileMode=false status --porcelain --untracked-files=no)" ]] || fail "Candidate has tracked content changes."
[[ -s "$RELEASE_ROOT/RELEASE_FILE_MANIFEST.sha256" ]] || fail "Release manifest is missing."
(cd "$RELEASE_ROOT" && sha256sum -c RELEASE_FILE_MANIFEST.sha256 >/dev/null) || fail "Release manifest verification failed."
printf 'Frozen commit: %s\n' "$EXPECTED_COMMIT"

say "Verifying current live backend before certification setup"
curl -fsS --connect-timeout 3 --max-time 10 http://127.0.0.1:8080/api/health/live
printf '\n'

say "Reading production PostgreSQL metadata without exposing credentials"
PROD_DATABASE_URL="$(bash -c 'set -a; source "$1"; : "${DATABASE_URL:?DATABASE_URL missing}"; printf "%s" "$DATABASE_URL"' _ "$ENV_FILE")" || fail "Could not read DATABASE_URL."
[[ "$PROD_DATABASE_URL" =~ ^postgres(ql)?:// ]] || fail "DATABASE_URL is not PostgreSQL."
readarray -t PROD_META < <(python3 - "$PROD_DATABASE_URL" <<'PY'
import sys
from urllib.parse import urlparse
u=urlparse(sys.argv[1]); print(u.hostname or ''); print(u.port or 5432)
PY
)
PROD_HOST="${PROD_META[0]:-}"; PROD_PORT="${PROD_META[1]:-5432}"
[[ -n "$PROD_HOST" ]] || fail "Production PostgreSQL host could not be parsed."
case "${PROD_HOST,,}" in localhost|127.0.0.1|::1) fail "Production PostgreSQL is local; refusing isolated local clone provisioning.";; esac
printf 'Production DB host: %s\nProduction DB port: %s\nCredentials: hidden\n' "$PROD_HOST" "$PROD_PORT"
PSQL_CLIENT="$(command -v psql 2>/dev/null || true)"; [[ -x "$PSQL_CLIENT" ]] || PSQL_CLIENT="$(find /usr/lib/postgresql -type f -path '*/bin/psql' 2>/dev/null | sort -V | tail -n1)"; [[ -x "$PSQL_CLIENT" ]] || fail "PostgreSQL client psql is missing."
PROD_INFO="$(PGCONNECT_TIMEOUT=10 "$PSQL_CLIENT" "$PROD_DATABASE_URL" -X -A -t -F '|' -v ON_ERROR_STOP=1 -c "SELECT current_setting('server_version_num'),pg_database_size(current_database()),d.datlocprovider,COALESCE(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale',''),d.datcollate,d.datctype FROM pg_database d WHERE d.datname=current_database();")" || fail "Cannot read production PostgreSQL locale metadata."
IFS='|' read -r PROD_VERSION_NUM PROD_DB_BYTES PROD_PROVIDER PROD_LOCALE PROD_COLLATE PROD_CTYPE <<<"$PROD_INFO"
[[ "$PROD_VERSION_NUM" =~ ^[0-9]+$ && "$PROD_DB_BYTES" =~ ^[0-9]+$ ]] || fail "Production PostgreSQL metadata is malformed."
PROD_MAJOR="$(python3 - "$PROD_VERSION_NUM" <<'PY'
import sys; print(int(sys.argv[1])//10000)
PY
)"
printf 'Production PostgreSQL major: %s\n' "$PROD_MAJOR"
printf 'Production locale provider: %s\nProduction ICU locale: %s\nProduction LC_COLLATE: %s\nProduction LC_CTYPE: %s\n' "$PROD_PROVIDER" "$PROD_LOCALE" "$PROD_COLLATE" "$PROD_CTYPE"
printf 'Production DB size: %.2f MiB\n' "$(python3 - "$PROD_DB_BYTES" <<'PY'
import sys; print(int(sys.argv[1])/1024/1024)
PY
)"
[[ "$PROD_PROVIDER" == "i" ]] || fail "Certification requires the same ICU provider as verified production; got provider=$PROD_PROVIDER."
[[ -n "$PROD_LOCALE" ]] || fail "Production ICU locale is empty."

say "Checking disk and isolated ports"
[[ "$LOCAL_PG_PORT" =~ ^[0-9]+$ && "$CERT_PORT" =~ ^[0-9]+$ ]] || fail "Certification ports must be numeric."
if ss -ltnH | awk '{print $4}' | grep -Eq "(^|:|\\])${LOCAL_PG_PORT}$"; then fail "Temporary PostgreSQL port $LOCAL_PG_PORT is occupied."; fi
if ss -ltnH | awk '{print $4}' | grep -Eq "(^|:|\\])${CERT_PORT}$"; then fail "Candidate backend port $CERT_PORT is occupied."; fi
FREE_BYTES="$(df -PB1 "$RELEASE_ROOT" | awk 'NR==2 {print $4}')"
REQUIRED_BYTES="$(python3 - "$PROD_DB_BYTES" <<'PY'
import sys; print(8*1024**3 + 3*int(sys.argv[1]))
PY
)"
python3 - "$FREE_BYTES" "$REQUIRED_BYTES" <<'PY'
import sys
free,req=map(int,sys.argv[1:3]); print(f'Free disk: {free/1024**3:.2f} GiB'); print(f'Required safety floor: {req/1024**3:.2f} GiB')
if free < req: raise SystemExit('Insufficient disk for certification/deployment safety floor.')
PY

PG_BIN="/usr/lib/postgresql/${PROD_MAJOR}/bin"; INITDB="$PG_BIN/initdb"; PG_CTL="$PG_BIN/pg_ctl"
if [[ ! -x "$INITDB" || ! -x "$PG_CTL" ]]; then
  say "Installing matching PostgreSQL ${PROD_MAJOR} server binaries with service autostart blocked"
  if [[ -e "$POLICY_FILE" || -L "$POLICY_FILE" ]]; then mv "$POLICY_FILE" "$POLICY_BACKUP"; POLICY_MOVED=1; fi
  cat >"$POLICY_FILE" <<'POLICY'
#!/bin/sh
# KALPAVRIKSHA_TEMP_NO_SERVICE_START
exit 101
POLICY
  chmod 0755 "$POLICY_FILE"; export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
  if ! apt-cache show "postgresql-${PROD_MAJOR}" >/dev/null 2>&1; then apt-get -o DPkg::Lock::Timeout=180 update; fi
  apt-cache show "postgresql-${PROD_MAJOR}" >/dev/null 2>&1 || fail "postgresql-${PROD_MAJOR} unavailable."
  apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends "postgresql-${PROD_MAJOR}"
  restore_policy_guard; [[ -x "$INITDB" && -x "$PG_CTL" ]] || fail "Matching PostgreSQL server binaries still missing."
  if command -v pg_lsclusters >/dev/null 2>&1 && command -v pg_dropcluster >/dev/null 2>&1; then
    while read -r maj name port status owner data log; do [[ "$maj" == "$PROD_MAJOR" && "$status" == "down" && "$data" == "/var/lib/postgresql/${PROD_MAJOR}/main" ]] || continue; pg_dropcluster --stop "$maj" "$name" || fail "Could not remove newly-created stopped apt cluster."; done < <(pg_lsclusters --no-header 2>/dev/null || true)
  fi
fi
export PATH="$PG_BIN:$PATH"
PSQL="$PG_BIN/psql"; PG_DUMP="$PG_BIN/pg_dump"; PG_RESTORE="$PG_BIN/pg_restore"; CREATEDB="$PG_BIN/createdb"; DROPDB="$PG_BIN/dropdb"
for pgtool in "$PSQL" "$PG_DUMP" "$PG_RESTORE" "$CREATEDB" "$DROPDB" "$INITDB" "$PG_CTL"; do [[ -x "$pgtool" ]] || fail "Required PostgreSQL tool unavailable: $pgtool"; done
TOOL_MAJOR="$("$PG_DUMP" --version | grep -Eo '[0-9]+(\.[0-9]+)?' | head -n1 | cut -d. -f1)"; [[ "$TOOL_MAJOR" == "$PROD_MAJOR" ]] || fail "pg_dump major mismatch."
PGCONNECT_TIMEOUT=10 "$PG_DUMP" --schema-only --no-owner --no-privileges "$PROD_DATABASE_URL" >/dev/null || fail "Matching pg_dump cannot read production."

say "Starting private temporary PostgreSQL on 127.0.0.1:${LOCAL_PG_PORT}"
mkdir -p "$PGDATA" "$PGSOCKET"; chown -R postgres:postgres "$PGROOT"; chmod 0700 "$PGDATA" "$PGSOCKET"
"$INITDB" --help | grep -Fq -- '--locale-provider' || fail "Installed initdb does not support locale-provider selection."
"$INITDB" --help | grep -Fq -- '--icu-locale' || fail "Installed initdb does not support ICU locale selection."
runuser -u postgres -- "$INITDB" -D "$PGDATA" --encoding=UTF8 --locale-provider=icu --icu-locale="$PROD_LOCALE" --auth-local=trust --auth-host=scram-sha-256 >/dev/null
cat >>"$PGDATA/postgresql.conf" <<PGCONF
listen_addresses = '127.0.0.1'
port = ${LOCAL_PG_PORT}
unix_socket_directories = '${PGSOCKET}'
max_connections = 50
password_encryption = 'scram-sha-256'
PGCONF
chown postgres:postgres "$PGDATA/postgresql.conf"; runuser -u postgres -- "$PG_CTL" -D "$PGDATA" -l "$PGROOT/postgresql.log" -w -t 60 start >/dev/null; TEMP_PG_STARTED=1
"$PSQL" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" -d postgres -X -A -t -v ON_ERROR_STOP=1 -c 'SELECT 1;' | grep -qx '1' || fail "Temporary PostgreSQL socket check failed."

say "Proving the temporary PostgreSQL locale matches production"
TEMP_INFO="$("$PSQL" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" -d postgres -X -A -t -F '|' -v ON_ERROR_STOP=1 -c "SELECT d.datlocprovider,COALESCE(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale','') FROM pg_database d WHERE d.datname=current_database();")"
IFS='|' read -r TEMP_PROVIDER TEMP_LOCALE <<<"$TEMP_INFO"
printf 'Production: provider=%s locale=%s\nTemporary : provider=%s locale=%s\n' "$PROD_PROVIDER" "$PROD_LOCALE" "$TEMP_PROVIDER" "$TEMP_LOCALE"
[[ "$TEMP_PROVIDER" == "$PROD_PROVIDER" && "$TEMP_LOCALE" == "$PROD_LOCALE" ]] || fail "Temporary PostgreSQL locale does not match production."

VERIFY_DB="kv_locale_verify_${RANDOM}${RANDOM}"
"$CREATEDB" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" "$VERIFY_DB"
VERIFY_INFO="$("$PSQL" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" -d "$VERIFY_DB" -X -A -t -F '|' -v ON_ERROR_STOP=1 -c "SELECT d.datlocprovider,COALESCE(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale','') FROM pg_database d WHERE d.datname=current_database();")"
IFS='|' read -r VERIFY_PROVIDER VERIFY_LOCALE <<<"$VERIFY_INFO"
"$DROPDB" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" --if-exists "$VERIFY_DB" >/dev/null
[[ "$VERIFY_PROVIDER" == "$PROD_PROVIDER" && "$VERIFY_LOCALE" == "$PROD_LOCALE" ]] || fail "New disposable databases do not inherit the production ICU provider/locale."
printf 'Disposable DB locale inheritance: PASS\n'

say "Preflighting exact dump/restore and TCP password mechanics"
PREFLIGHT_SUFFIX="${RANDOM}${RANDOM}"
PREFLIGHT_ROLE="kv_preflight_${PREFLIGHT_SUFFIX}"
PREFLIGHT_DB1="kv_preflight_src_${PREFLIGHT_SUFFIX}"
PREFLIGHT_DB2="kv_preflight_dst_${PREFLIGHT_SUFFIX}"
PREFLIGHT_PASSWORD="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
)"
PREFLIGHT_DIR="$PGROOT/preflight"
install -d -m 0700 "$PREFLIGHT_DIR"

# Database client commands run as root and authenticate explicitly as the
# temporary PostgreSQL superuser. Only initdb/pg_ctl run as OS user postgres.
# This makes dump/restore independent of Linux directory ownership.
"$PSQL" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$PREFLIGHT_ROLE\" LOGIN PASSWORD '$PREFLIGHT_PASSWORD';" >/dev/null
"$CREATEDB" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" -O "$PREFLIGHT_ROLE" "$PREFLIGHT_DB1"
"$CREATEDB" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" -O "$PREFLIGHT_ROLE" "$PREFLIGHT_DB2"
# Mirror the real certification clone exactly: the disposable application role
# owns the destination schema/table, while PostgreSQL superuser restores DATA
# ONLY into that already-existing role-owned table.  This validates dump-file
# access, restore mechanics, destination ownership, and TCP/SCRAM authentication
# without accidentally making restored objects superuser-owned.
PGPASSWORD="$PREFLIGHT_PASSWORD" "$PSQL" -h 127.0.0.1 -p "$LOCAL_PG_PORT" -U "$PREFLIGHT_ROLE" -d "$PREFLIGHT_DB1" -v ON_ERROR_STOP=1 -c "CREATE TABLE cert_restore_probe(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO cert_restore_probe VALUES (1,'ok');" >/dev/null
PGPASSWORD="$PREFLIGHT_PASSWORD" "$PSQL" -h 127.0.0.1 -p "$LOCAL_PG_PORT" -U "$PREFLIGHT_ROLE" -d "$PREFLIGHT_DB2" -v ON_ERROR_STOP=1 -c "CREATE TABLE cert_restore_probe(id integer PRIMARY KEY, value text NOT NULL);" >/dev/null
PREFLIGHT_DUMP="$PREFLIGHT_DIR/restore.dump"
"$PG_DUMP" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" --format=custom --data-only --table=public.cert_restore_probe --no-owner --no-privileges --file="$PREFLIGHT_DUMP" "$PREFLIGHT_DB1"
chmod 0600 "$PREFLIGHT_DUMP"
"$PG_RESTORE" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" --dbname="$PREFLIGHT_DB2" --data-only --disable-triggers --no-owner --no-privileges --exit-on-error "$PREFLIGHT_DUMP"
PREFLIGHT_OWNER="$("$PSQL" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" -d "$PREFLIGHT_DB2" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename='cert_restore_probe';")"
[[ "$PREFLIGHT_OWNER" == "$PREFLIGHT_ROLE" ]] || fail "Preflight destination table ownership changed during data-only restore."
PREFLIGHT_VALUE="$(PGPASSWORD="$PREFLIGHT_PASSWORD" "$PSQL" -h 127.0.0.1 -p "$LOCAL_PG_PORT" -U "$PREFLIGHT_ROLE" -d "$PREFLIGHT_DB2" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT value FROM cert_restore_probe WHERE id=1;")"
[[ "$PREFLIGHT_VALUE" == "ok" ]] || fail "Temporary PostgreSQL restore/auth preflight failed."
"$DROPDB" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" --if-exists "$PREFLIGHT_DB2" >/dev/null
"$DROPDB" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" --if-exists "$PREFLIGHT_DB1" >/dev/null
"$PSQL" -U postgres -h "$PGSOCKET" -p "$LOCAL_PG_PORT" -d postgres -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS \"$PREFLIGHT_ROLE\";" >/dev/null
rm -rf "$PREFLIGHT_DIR"
printf 'Database restore/auth preflight: PASS\n'

say "Running isolated candidate certification; production cutover is still blocked"
rm -f /root/kalpavriksha-certified-candidate.commit /root/kalpavriksha-certified-candidate.result.json /root/kalpavriksha-certified-candidate.logpath
cd "$RELEASE_ROOT"
env PATH="$PATH" VITE_API_URL="$API_URL" VITE_API_BASE="$API_URL" KALPA_CERT_PG_HOST="$PGSOCKET" KALPA_CERT_PG_PORT="$LOCAL_PG_PORT" KALPA_CERT_DB_TCP_HOST=127.0.0.1 KALPA_CERT_PORT="$CERT_PORT" bash scripts/candidate-certify-1.9.30-vps.sh

say "Verifying certification receipt before removing temporary PostgreSQL"
[[ -s /root/kalpavriksha-certified-candidate.commit && -s /root/kalpavriksha-certified-candidate.result.json ]] || fail "Candidate certification receipt is missing."
[[ "$(tr -d '[:space:]' < /root/kalpavriksha-certified-candidate.commit)" == "$EXPECTED_COMMIT" ]] || fail "Candidate certification receipt commit mismatch."
python3 - /root/kalpavriksha-certified-candidate.result.json "$EXPECTED_COMMIT" <<'PY'
import json,sys
p=json.load(open(sys.argv[1])); expected=sys.argv[2]
if p.get('ok') is not True or p.get('status')!='CERTIFIED_FOR_GUARDED_DEPLOYMENT' or p.get('commit')!=expected: raise SystemExit('candidate certification receipt invalid')
e=p.get('e2e') or {}
for key in ('downloadHashMatched','staleOptimisticIdResolvedToCanonicalTask','wrongTaskAttachmentPrevented'):
    if e.get(key) is not True: raise SystemExit(f'missing E2E proof: {key}')
print('Candidate certification receipt: PASS')
PY

say "Stopping and deleting temporary PostgreSQL before production deployment"
stop_temp_postgres; restore_policy_guard

say "Rechecking live backend and frozen GitHub commit immediately before deployment"
curl -fsS --connect-timeout 3 --max-time 10 http://127.0.0.1:8080/api/health/live; printf '\n'
REMOTE_BEFORE_DEPLOY="$(git -C "$RELEASE_ROOT" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"; [[ "$REMOTE_BEFORE_DEPLOY" == "$EXPECTED_COMMIT" ]] || fail "GitHub main changed after certification."
[[ -z "$(git -C "$RELEASE_ROOT" -c core.fileMode=false status --porcelain --untracked-files=no)" ]] || fail "Tracked candidate source changed after certification."

say "Launching guarded production deployment as an SSH-independent systemd unit"
bash scripts/launch-deploy-1.9.30-vps.sh
DEPLOY_UNIT="$(cat /root/kalpavriksha-deploy-last-unit)"; [[ -n "$DEPLOY_UNIT" ]] || fail "Deployment launcher did not record a unit."; DEPLOY_STARTED=1; printf 'Deployment unit: %s\n' "$DEPLOY_UNIT"

say "Waiting for guarded deployment to finish; SSH disconnect will not stop the unit"
for _ in $(seq 1 720); do ACTIVE_STATE="$(systemctl show "$DEPLOY_UNIT" -p ActiveState --value 2>/dev/null || true)"; if [[ "$ACTIVE_STATE" != "active" && "$ACTIVE_STATE" != "activating" && "$ACTIVE_STATE" != "reloading" ]]; then break; fi; sleep 5; done
FINAL_ACTIVE_STATE="$(systemctl show "$DEPLOY_UNIT" -p ActiveState --value 2>/dev/null || true)"; [[ "$FINAL_ACTIVE_STATE" != "active" && "$FINAL_ACTIVE_STATE" != "activating" && "$FINAL_ACTIVE_STATE" != "reloading" ]] || fail "Guarded deployment did not finish within one hour."
RESULT="$(systemctl show "$DEPLOY_UNIT" -p Result --value 2>/dev/null || true)"; EXEC_STATUS="$(systemctl show "$DEPLOY_UNIT" -p ExecMainStatus --value 2>/dev/null || true)"; journalctl -u "$DEPLOY_UNIT" --no-pager -n 300 -l || true
[[ "$RESULT" == "success" && "$EXEC_STATUS" == "0" ]] || fail "Guarded deployment unit failed (Result=$RESULT ExecMainStatus=$EXEC_STATUS)."

say "Verifying permanent PM2 path, local readiness and public endpoints"
PM2_INFO="$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);if(!p)process.exit(2);console.log((p.pm2_env.pm_exec_path||'')+'|'+(p.pm2_env.pm_cwd||'')+'|'+(p.pm2_env.status||''));});" kalpvriksha-backend)" || fail "PM2 backend process is missing."
IFS='|' read -r PM2_SCRIPT PM2_CWD PM2_STATUS <<<"$PM2_INFO"
[[ "$(realpath -m "$PM2_SCRIPT")" == "$(realpath -m "$LIVE_ROOT/backend/src/server.js")" ]] || fail "PM2 is not running permanent live backend script."
[[ "$(realpath -m "$PM2_CWD")" == "$(realpath -m "$LIVE_ROOT/backend")" && "$PM2_STATUS" == "online" ]] || fail "PM2 permanent backend cwd/status is invalid."
for endpoint in /api/health/live /api/health/ready; do OK=0; for _ in $(seq 1 30); do if curl -fsS --connect-timeout 2 --max-time 8 "http://127.0.0.1:8080${endpoint}" >/dev/null; then OK=1; break; fi; sleep 2; done; [[ "$OK" == "1" ]] || fail "Permanent local endpoint failed: $endpoint"; done
PUBLIC_API_OK=0; for _ in $(seq 1 30); do if curl -fsS --connect-timeout 4 --max-time 12 "${PUBLIC_API_URL}/api/health/live" >/dev/null; then PUBLIC_API_OK=1; break; fi; sleep 5; done; [[ "$PUBLIC_API_OK" == "1" ]] || fail "Public API health endpoint did not become reachable."
FRONTEND_OK=0; FRONTEND_PROBE="/tmp/kalpavriksha-frontend-probe-${STAMP}.html"; for _ in $(seq 1 60); do if curl -fsSL --connect-timeout 4 --max-time 15 -o "$FRONTEND_PROBE" "$PUBLIC_FRONTEND_URL" && grep -Eqi '<html|id="root"' "$FRONTEND_PROBE"; then FRONTEND_OK=1; break; fi; sleep 5; done; rm -f "$FRONTEND_PROBE"; [[ "$FRONTEND_OK" == "1" ]] || fail "Public frontend did not become reachable within five minutes."
REMOTE_AFTER="$(git -C "$RELEASE_ROOT" ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"; [[ "$REMOTE_AFTER" == "$EXPECTED_COMMIT" ]] || fail "GitHub main changed during deployment."

python3 - /root/kalpavriksha-final-deployment.result.json "$EXPECTED_COMMIT" "$DEPLOY_UNIT" <<'PY'
import json,sys,datetime
out,commit,unit=sys.argv[1:4]
json.dump({'ok':True,'status':'DEPLOYED_AND_PUBLICLY_VERIFIED','commit':commit,'deploymentUnit':unit,'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':{'candidateCertified':True,'temporaryPostgresRemovedBeforeDeploy':True,'deploymentUnitSuccess':True,'pm2PermanentPath':True,'localLiveReady':True,'publicApiLive':True,'publicFrontendReachable':True}},open(out,'w'),indent=2)
PY
printf '\n======================================================\n KALPAVRIKSHA FINAL RELEASE DEPLOYED AND VERIFIED\n======================================================\nCommit: %s\nPM2: permanent live path and online\nLocal API: live + ready\nPublic API: reachable\nPublic frontend: reachable\nResult: /root/kalpavriksha-final-deployment.result.json\n======================================================\n' "$EXPECTED_COMMIT"
