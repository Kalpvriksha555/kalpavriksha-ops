#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

RELEASE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE_ROOT="${KALPA_LIVE_ROOT:-/var/www/kalpavriksha-ops}"
ENV_FILE="${KALPA_ENV_FILE:-/etc/kalpavriksha/backend.env}"
LOCK_FILE="${KALPA_CANDIDATE_LOCK:-/run/lock/kalpavriksha-candidate-certification.lock}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ROOT="${KALPA_CANDIDATE_RUN_ROOT:-/root/kalpavriksha-candidate-certification-${STAMP}}"
LOG_FILE="$RUN_ROOT/certification.log"
RESULT_FILE="$RUN_ROOT/result.json"
CERTIFIED_COMMIT_FILE="${KALPA_CERTIFIED_COMMIT_FILE:-/root/kalpavriksha-certified-candidate.commit}"
CERTIFIED_RESULT_FILE="${KALPA_CERTIFIED_RESULT_FILE:-/root/kalpavriksha-certified-candidate.result.json}"

EXPECTED_ROOT_VERSION="1.9.30-runtime-persistence-recovery"
EXPECTED_BACKEND_VERSION="2.9.30-runtime-persistence-recovery"
EXPECTED_FRONTEND_VERSION="2.9.30-runtime-persistence-recovery"
CREATE_MAX_SECONDS="${KALPA_CERT_CREATE_MAX_SECONDS:-5}"
UPLOAD_MAX_SECONDS="${KALPA_CERT_UPLOAD_MAX_SECONDS:-20}"
DOWNLOAD_MAX_SECONDS="${KALPA_CERT_DOWNLOAD_MAX_SECONDS:-10}"
MIN_FREE_KB="${KALPA_CERT_MIN_FREE_KB:-8388608}" # 8 GiB

mkdir -p "$RUN_ROOT"
exec > >(tee -a "$LOG_FILE") 2>&1

log() {
  printf '\n[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

fail() {
  echo "CANDIDATE CERTIFICATION FAILED: $*" >&2
  exit 1
}

command_path() {
  local name="$1"
  local found
  found="$(command -v "$name" 2>/dev/null || true)"
  if [[ -n "$found" ]]; then
    printf '%s' "$found"
    return 0
  fi
  found="$(find /usr/lib/postgresql -type f -path "*/bin/$name" 2>/dev/null | sort -V | tail -n 1)"
  [[ -n "$found" ]] || return 1
  printf '%s' "$found"
}

mkdir -p "$(dirname "$LOCK_FILE")"
exec 8>>"$LOCK_FILE"
flock -n 8 || fail "Another candidate certification is already running."

[[ "$RELEASE_ROOT" != "$LIVE_ROOT" ]] || fail "Candidate certification must never run from the live source directory."
[[ -f "$RELEASE_ROOT/package.json" ]] || fail "package.json is missing from the candidate."
[[ -f "$RELEASE_ROOT/RELEASE_FILE_MANIFEST.sha256" ]] || fail "Release manifest is missing."
[[ -s "$ENV_FILE" ]] || fail "Production environment file is missing; it is needed only to take a read-only database snapshot."

for tool in git node npm curl python3 sha256sum flock runuser tee; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required."
done
PG_DUMP="$(command_path pg_dump)" || fail "pg_dump is required."
PG_RESTORE="$(command_path pg_restore)" || fail "pg_restore is required."
PSQL="$(command_path psql)" || fail "psql is required."
CREATEDB="$(command_path createdb)" || fail "createdb is required."
DROPDB="$(command_path dropdb)" || fail "dropdb is required."

FREE_KB="$(df -Pk "$RELEASE_ROOT" | awk 'NR==2 {print $4}')"
[[ "$FREE_KB" =~ ^[0-9]+$ ]] || fail "Could not determine free disk space."
(( FREE_KB >= MIN_FREE_KB )) || fail "At least $((MIN_FREE_KB/1024/1024)) GiB free disk is required for isolated install, clean-install verification, and the disposable production-data clone."

cd "$RELEASE_ROOT"
COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
[[ -n "$REMOTE_COMMIT" ]] || fail "Could not resolve GitHub main."
[[ "$COMMIT" == "$REMOTE_COMMIT" ]] || fail "Candidate commit $COMMIT is not the current GitHub main $REMOTE_COMMIT."

ROOT_VERSION="$(node -e "process.stdout.write(require('./package.json').version)")"
BACKEND_VERSION="$(node -e "process.stdout.write(require('./backend/package.json').version)")"
FRONTEND_VERSION="$(node -e "process.stdout.write(require('./frontend/package.json').version)")"
[[ "$ROOT_VERSION" == "$EXPECTED_ROOT_VERSION" ]] || fail "Unexpected root version: $ROOT_VERSION"
[[ "$BACKEND_VERSION" == "$EXPECTED_BACKEND_VERSION" ]] || fail "Unexpected backend version: $BACKEND_VERSION"
[[ "$FRONTEND_VERSION" == "$EXPECTED_FRONTEND_VERSION" ]] || fail "Unexpected frontend version: $FRONTEND_VERSION"

log "Candidate commit: $COMMIT"
log "Verifying packaged source manifest before dependency installation"
sha256sum -c RELEASE_FILE_MANIFEST.sha256 >/dev/null

log "Installing dependencies only inside the isolated candidate"
export npm_config_registry="https://registry.npmjs.org/"
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm ci --prefix backend --no-audit --no-fund
npm ci --prefix frontend --include=dev --no-audit --no-fund

log "Confirming React and ReactDOM resolve from the same frontend dependency tree"
node <<'NODE'
const path=require('node:path');
const {createRequire}=require('node:module');
const r=createRequire(path.resolve('frontend/package.json'));
const react=r.resolve('react');
const dom=r.resolve('react-dom/server');
const reactPkg=require(path.join(path.dirname(r.resolve('react/package.json')),'package.json'));
const domPkg=require(path.join(path.dirname(r.resolve('react-dom/package.json')),'package.json'));
console.log(JSON.stringify({react,reactDomServer:dom,reactVersion:reactPkg.version,reactDomVersion:domPkg.version},null,2));
if(reactPkg.version!==domPkg.version) process.exit(2);
if(!react.includes(`${path.sep}frontend${path.sep}node_modules${path.sep}react${path.sep}`)) process.exit(3);
if(!dom.includes(`${path.sep}frontend${path.sep}node_modules${path.sep}react-dom${path.sep}`)) process.exit(4);
NODE

log "Running the real signed-out React/Vite runtime bootstrap"
npm run verify:frontend-runtime

log "Running the complete release verification chain, including all frontend/backend tests and production build"
npm run verify

log "Running a second clean-install production build from a copied source tree"
npm run release:clean-install

[[ -s frontend/dist/index.html ]] || fail "Production frontend build was not created."
log "Re-verifying packaged source manifest after all verification/build activity"
sha256sum -c RELEASE_FILE_MANIFEST.sha256 >/dev/null
if ! git -c core.fileMode=false diff --quiet -- .; then
  git -c core.fileMode=false diff --stat
  fail "Verification modified tracked source files."
fi

# ---------------------------------------------------------------------------
# Disposable end-to-end runtime certification.
# A transaction-consistent pg_dump of production is restored into a new local
# PostgreSQL database. All writes below go only to that disposable clone.
# The live database, live private-file root, live frontend, and PM2 process are
# never modified by this script.
# ---------------------------------------------------------------------------
log "Preparing a disposable PostgreSQL clone for realistic case/upload timing"
PROD_DATABASE_URL="$(bash -c 'set -a; source "$1"; printf %s "$DATABASE_URL"' _ "$ENV_FILE")"
[[ "$PROD_DATABASE_URL" =~ ^postgres(ql)?:// ]] || fail "DATABASE_URL in production environment is not a PostgreSQL URL."

CERT_SUFFIX="$(date -u +%H%M%S)${RANDOM}"
CERT_ROLE="kv_cert_${CERT_SUFFIX}"
CERT_DB="kv_cert_${CERT_SUFFIX}"
CERT_DB_PASSWORD="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
)"
CERT_ADMIN_USERNAME="certadmin_${CERT_SUFFIX}"
CERT_ADMIN_PASSWORD="$(python3 - <<'PY'
import secrets
print('KvCert!'+secrets.token_hex(12)+'Aa9')
PY
)"
SANDBOX="$RUN_ROOT/runtime"
DUMP_FILE="$RUN_ROOT/production-snapshot.dump"
COOKIE_JAR="$RUN_ROOT/cookies.txt"
BACKEND_LOG="$RUN_ROOT/candidate-backend.log"
CERT_PORT="${KALPA_CERT_PORT:-18080}"
BACKEND_PID=""
DB_CREATED=0
ROLE_CREATED=0

cleanup_runtime() {
  set +e
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$BACKEND_PID" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ "$DB_CREATED" == "1" ]]; then
    runuser -u postgres -- "$DROPDB" --if-exists "$CERT_DB" >/dev/null 2>&1 || true
  fi
  if [[ "$ROLE_CREATED" == "1" ]]; then
    runuser -u postgres -- "$PSQL" -d postgres -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS \"$CERT_ROLE\";" >/dev/null 2>&1 || true
  fi
}
trap cleanup_runtime EXIT INT TERM ERR

runuser -u postgres -- "$PSQL" -d postgres -Atqc 'SELECT 1' >/dev/null || fail "Local PostgreSQL superuser access is unavailable."
runuser -u postgres -- "$PSQL" -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$CERT_ROLE\" LOGIN PASSWORD '$CERT_DB_PASSWORD';" >/dev/null
ROLE_CREATED=1
runuser -u postgres -- "$CREATEDB" -O "$CERT_ROLE" "$CERT_DB"
DB_CREATED=1

log "Taking a read-only transaction-consistent snapshot of the live PostgreSQL database"
"$PG_DUMP" --format=custom --no-owner --no-privileges --file="$DUMP_FILE" "$PROD_DATABASE_URL"
[[ -s "$DUMP_FILE" ]] || fail "Production database snapshot is empty."

log "Restoring the snapshot only into disposable database $CERT_DB"
runuser -u postgres -- "$PG_RESTORE" --dbname="$CERT_DB" --role="$CERT_ROLE" --no-owner --no-privileges "$DUMP_FILE"
CERT_DATABASE_URL="postgresql://${CERT_ROLE}:${CERT_DB_PASSWORD}@127.0.0.1:5432/${CERT_DB}"

# Remove only authentication credentials/sessions from the disposable clone so
# a known certification administrator can be bootstrapped without knowing any
# production password. Operational production-like rows remain in the clone.
"$PSQL" "$CERT_DATABASE_URL" -v ON_ERROR_STOP=1 -c "TRUNCATE TABLE auth_sessions, auth_credentials RESTART IDENTITY CASCADE; DELETE FROM app_state WHERE key='main';" >/dev/null

mkdir -p "$SANDBOX/files" "$SANDBOX/data" "$SANDBOX/uploads" "$SANDBOX/backups"

log "Starting the candidate backend on loopback port $CERT_PORT against the disposable database and file root"
(
  cd "$RELEASE_ROOT/backend"
  env \
    NODE_ENV=development \
    HOST=127.0.0.1 \
    PORT="$CERT_PORT" \
    DATABASE_URL="$CERT_DATABASE_URL" \
    DB_SSL=false \
    BACKUP_REQUIRED=false \
    RELEASE_CERTIFICATE_REQUIRED=false \
    KALPA_FILE_STORAGE_ROOT="$SANDBOX/files" \
    KALPA_DATA_DIR="$SANDBOX/data" \
    KALPA_UPLOAD_DIR="$SANDBOX/uploads" \
    KALPA_BACKUP_ROOT="$SANDBOX/backups" \
    FILE_ANTIVIRUS_MODE=disabled \
    FILE_ANTIVIRUS_REQUIRED=false \
    BOOTSTRAP_ADMIN_USERNAME="$CERT_ADMIN_USERNAME" \
    BOOTSTRAP_ADMIN_PASSWORD="$CERT_ADMIN_PASSWORD" \
    BOOTSTRAP_ADMIN_NAME='Candidate Certification Admin' \
    SESSION_COOKIE_NAME='kalpa_candidate_session' \
    API_WRITE_RATE_LIMIT=1000 \
    node src/server.js >"$BACKEND_LOG" 2>&1 &
  echo $! >"$RUN_ROOT/backend.pid"
)
BACKEND_PID="$(cat "$RUN_ROOT/backend.pid")"

for _ in $(seq 1 120); do
  if curl -fsS --connect-timeout 1 --max-time 3 "http://127.0.0.1:${CERT_PORT}/api/health/live" >"$RUN_ROOT/live.json" 2>/dev/null; then
    break
  fi
  kill -0 "$BACKEND_PID" 2>/dev/null || { tail -n 160 "$BACKEND_LOG"; fail "Candidate backend exited during startup."; }
  sleep 1
done
curl -fsS --max-time 5 "http://127.0.0.1:${CERT_PORT}/api/health/live" >"$RUN_ROOT/live.json" || { tail -n 160 "$BACKEND_LOG"; fail "Candidate backend liveness did not become healthy."; }
curl -fsS --max-time 10 "http://127.0.0.1:${CERT_PORT}/api/health/ready" >"$RUN_ROOT/ready.json" || { cat "$RUN_ROOT/ready.json" 2>/dev/null || true; tail -n 160 "$BACKEND_LOG"; fail "Candidate backend readiness failed."; }
python3 - "$RUN_ROOT/ready.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
if not p.get('ok') or p.get('status')!='READY':
    raise SystemExit('candidate readiness payload is not READY')
checks=p.get('checks') or {}
for key in ('database','privateStorage','persistence'):
    if checks.get(key) is not True:
        raise SystemExit(f'candidate readiness check failed: {key}')
PY

log "Logging into the disposable candidate as its one-time certification administrator"
python3 - "$RUN_ROOT/login-request.json" "$CERT_ADMIN_USERNAME" "$CERT_ADMIN_PASSWORD" <<'PY'
import json,sys
json.dump({'username':sys.argv[2],'password':sys.argv[3]},open(sys.argv[1],'w'))
PY
curl -fsS -c "$COOKIE_JAR" -H 'Content-Type: application/json' --data-binary "@$RUN_ROOT/login-request.json" \
  "http://127.0.0.1:${CERT_PORT}/api/auth/login" >"$RUN_ROOT/login-response.json"
CSRF_TOKEN="$(python3 - "$RUN_ROOT/login-response.json" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
if not p.get('ok') or not p.get('authenticated') or not p.get('csrfToken'):
    raise SystemExit(2)
print(p['csrfToken'])
PY
)" || fail "Candidate administrator login failed."

TODAY="$(TZ=Asia/Kolkata date +%F)"
REQUESTED_ID="CERT-${CERT_SUFFIX}-01"
MUTATION_A="create-cert-a-${CERT_SUFFIX}"
MUTATION_B="create-cert-b-${CERT_SUFFIX}"
UPLOAD_MUTATION="upload-cert-${CERT_SUFFIX}"

make_create_payload() {
  local output="$1" mutation="$2"
  python3 - "$output" "$REQUESTED_ID" "$mutation" "$TODAY" <<'PY'
import json,sys,time
output,task_id,mutation,today=sys.argv[1:5]
now=int(time.time()*1000)
payload={
  'operation':'create',
  'mutationId':mutation,
  'expectedTaskVersion':0,
  'project':{
    'id':task_id,
    'caseId':task_id,
    'displayId':task_id,
    'taskName':'Candidate certification case',
    'client':'Candidate Certification',
    'customerName':'Disposable Test Customer',
    'location':'Candidate Lab',
    'type':'Map Estimate',
    'description':'Disposable isolated VPS certification record',
    'priority':'Normal',
    'assignedTo':'Unassigned',
    'status':'Lead Received',
    'taskDate':today,
    'createdAt':now,
    'recordedAt':now,
    'updatedAt':now,
    'documents':[],
    'timeline':[],
    'ledger':{}
  }
}
json.dump(payload,open(output,'w'))
PY
}

api_post_json() {
  local payload="$1" output="$2"
  curl -sS -b "$COOKIE_JAR" \
    -H 'Content-Type: application/json' \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    --data-binary "@$payload" \
    -o "$output" \
    -w '%{http_code} %{time_total}' \
    "http://127.0.0.1:${CERT_PORT}/api/state/projects"
}

assert_http_success_and_time() {
  local label="$1" stats="$2" body="$3" max_seconds="$4"
  local code elapsed
  code="${stats%% *}"
  elapsed="${stats#* }"
  if [[ "$code" != "200" && "$code" != "201" ]]; then
    cat "$body" || true
    fail "$label returned HTTP $code."
  fi
  python3 - "$elapsed" "$max_seconds" "$label" <<'PY'
import sys
elapsed=float(sys.argv[1]); maximum=float(sys.argv[2]); label=sys.argv[3]
print(f'{label}: {elapsed:.3f}s (limit {maximum:.3f}s)')
if elapsed > maximum:
    raise SystemExit(f'{label} exceeded latency limit')
PY
}

log "E2E step 1/6: create a normal task and measure server-side latency"
make_create_payload "$RUN_ROOT/create-a.json" "$MUTATION_A"
CREATE_A_STATS="$(api_post_json "$RUN_ROOT/create-a.json" "$RUN_ROOT/create-a-response.json")"
assert_http_success_and_time "first case creation" "$CREATE_A_STATS" "$RUN_ROOT/create-a-response.json" "$CREATE_MAX_SECONDS"
CANONICAL_A="$(python3 - "$RUN_ROOT/create-a-response.json" "$REQUESTED_ID" <<'PY'
import json,sys
p=json.load(open(sys.argv[1])); expected=sys.argv[2]
if not p.get('ok'): raise SystemExit(2)
c=p.get('project') or p.get('case') or {}
value=str(c.get('id') or c.get('caseId') or '')
if value!=expected: raise SystemExit(f'first create unexpectedly changed id: {value}')
print(value)
PY
)" || fail "First task creation response was invalid."

log "E2E step 2/6: force an optimistic task-ID collision and require a new canonical server ID"
make_create_payload "$RUN_ROOT/create-b.json" "$MUTATION_B"
CREATE_B_STATS="$(api_post_json "$RUN_ROOT/create-b.json" "$RUN_ROOT/create-b-response.json")"
assert_http_success_and_time "collision case creation" "$CREATE_B_STATS" "$RUN_ROOT/create-b-response.json" "$CREATE_MAX_SECONDS"
CANONICAL_B="$(python3 - "$RUN_ROOT/create-b-response.json" "$REQUESTED_ID" <<'PY'
import json,sys
p=json.load(open(sys.argv[1])); requested=sys.argv[2]
if not p.get('ok') or p.get('taskIdAllocated') is not True: raise SystemExit('server did not report canonical ID allocation')
c=p.get('project') or p.get('case') or {}
value=str(c.get('id') or c.get('caseId') or '')
if not value or value==requested: raise SystemExit('collision did not allocate a different canonical task id')
print(value)
PY
)" || fail "Collision task creation did not allocate a safe canonical ID."

log "E2E step 3/6: replay the same create mutation to simulate a lost browser response"
REPLAY_STATS="$(api_post_json "$RUN_ROOT/create-b.json" "$RUN_ROOT/create-b-replay-response.json")"
assert_http_success_and_time "idempotent create replay" "$REPLAY_STATS" "$RUN_ROOT/create-b-replay-response.json" "$CREATE_MAX_SECONDS"
python3 - "$RUN_ROOT/create-b-replay-response.json" "$CANONICAL_B" <<'PY'
import json,sys
p=json.load(open(sys.argv[1])); expected=sys.argv[2]
c=p.get('project') or p.get('case') or {}
value=str(c.get('id') or c.get('caseId') or '')
if not p.get('ok') or not p.get('idempotent') or value!=expected:
    raise SystemExit('idempotent create replay did not return the committed canonical task')
PY

log "E2E step 4/6: upload a real 4 MiB PDF using the stale optimistic ID plus the committed create mutation"
python3 - "$RUN_ROOT/candidate-upload.pdf" <<'PY'
import sys
p=sys.argv[1]
size=4*1024*1024
head=b'%PDF-1.4\n% Kalpavriksha isolated candidate upload certification\n'
with open(p,'wb') as f:
    f.write(head)
    f.write(b'0'*(size-len(head)))
PY
ORIGINAL_SHA="$(sha256sum "$RUN_ROOT/candidate-upload.pdf" | awk '{print $1}')"
UPLOAD_STATS="$(curl -sS -b "$COOKIE_JAR" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -F "file=@$RUN_ROOT/candidate-upload.pdf;type=application/pdf" \
  -F "projectId=$REQUESTED_ID" \
  -F "taskMutationId=$MUTATION_B" \
  -F "mutationId=$UPLOAD_MUTATION" \
  -F 'type=source' \
  -o "$RUN_ROOT/upload-response.json" \
  -w '%{http_code} %{time_total}' \
  "http://127.0.0.1:${CERT_PORT}/api/files/upload")"
assert_http_success_and_time "4 MiB source upload" "$UPLOAD_STATS" "$RUN_ROOT/upload-response.json" "$UPLOAD_MAX_SECONDS"
FILE_ID="$(python3 - "$RUN_ROOT/upload-response.json" "$CANONICAL_B" "$REQUESTED_ID" <<'PY'
import json,sys
p=json.load(open(sys.argv[1])); expected=sys.argv[2]; requested=sys.argv[3]
if not p.get('ok'): raise SystemExit('upload response not ok')
if str(p.get('resolvedProjectId') or '')!=expected: raise SystemExit(f'upload resolved to wrong task: {p.get("resolvedProjectId")}')
if str(p.get('requestedProjectId') or '')!=requested: raise SystemExit('upload did not preserve requested stale id diagnostic')
f=p.get('file') or {}
if str(f.get('caseId') or '')!=expected: raise SystemExit('stored file was linked to the wrong canonical task')
file_id=str(f.get('id') or '')
if not file_id: raise SystemExit('upload response did not include file id')
print(file_id)
PY
)" || fail "Upload did not resolve the stale optimistic ID to the correct canonical case."

log "E2E step 5/6: prove the file is attached only to the canonical task and not the collided older task"
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${CERT_PORT}/api/state?performance=false" >"$RUN_ROOT/state-after-upload.json"
python3 - "$RUN_ROOT/state-after-upload.json" "$CANONICAL_A" "$CANONICAL_B" "$FILE_ID" <<'PY'
import json,sys
p=json.load(open(sys.argv[1])); a,b,fid=sys.argv[2:5]
cases=p.get('cases') or p.get('projects') or []
def find(cid):
    for c in cases:
        ids=[c.get('id'),c.get('caseId'),c.get('displayId')]
        if cid in {str(x) for x in ids if x is not None}: return c
    return None
def file_ids(c):
    values=[]
    for key in ('documents','completedFiles','sourceFiles','workFiles','files','attachments'):
        for f in (c or {}).get(key) or []:
            if isinstance(f,dict) and f.get('id') is not None: values.append(str(f['id']))
    return set(values)
ca,cb=find(a),find(b)
if not ca or not cb: raise SystemExit('certification cases missing from state')
if fid in file_ids(ca): raise SystemExit('uploaded file was incorrectly attached to collided original task')
if fid not in file_ids(cb): raise SystemExit('uploaded file is missing from canonical task')
PY

log "E2E step 6/6: download the stored file and verify exact bytes"
DOWNLOAD_STATS="$(curl -sS -b "$COOKIE_JAR" \
  -o "$RUN_ROOT/downloaded.pdf" \
  -w '%{http_code} %{time_total}' \
  "http://127.0.0.1:${CERT_PORT}/api/files/${FILE_ID}/download")"
assert_http_success_and_time "4 MiB file download" "$DOWNLOAD_STATS" "$RUN_ROOT/downloaded.pdf" "$DOWNLOAD_MAX_SECONDS"
DOWNLOADED_SHA="$(sha256sum "$RUN_ROOT/downloaded.pdf" | awk '{print $1}')"
[[ "$DOWNLOADED_SHA" == "$ORIGINAL_SHA" ]] || fail "Downloaded file bytes do not match uploaded bytes."

log "Scanning the candidate runtime log for relational, target-resolution, and uncaught runtime failures"
if grep -Eiq 'RELATIONAL_SHADOW_HASH_DIVERGENCE|RELATIONAL_SHADOW_DIVERGENCE|RELATIONAL_SELECTED_COLLECTION_MISMATCH|RELATIONAL_METADATA_COMPARE_AND_SWAP_FAILED|The target task was not found|uncaughtException|unhandledRejection' "$BACKEND_LOG"; then
  grep -Ein 'RELATIONAL_SHADOW_HASH_DIVERGENCE|RELATIONAL_SHADOW_DIVERGENCE|RELATIONAL_SELECTED_COLLECTION_MISMATCH|RELATIONAL_METADATA_COMPARE_AND_SWAP_FAILED|The target task was not found|uncaughtException|unhandledRejection' "$BACKEND_LOG" || true
  fail "Candidate backend log contains a forbidden runtime failure marker."
fi

# Ensure GitHub main did not move while the candidate was being certified.
REMOTE_AFTER="$(git ls-remote origin refs/heads/main | awk 'NR==1 {print $1}')"
[[ "$REMOTE_AFTER" == "$COMMIT" ]] || fail "GitHub main changed during certification ($COMMIT -> $REMOTE_AFTER). Re-certify the new commit instead of deploying this one."

CREATE_A_TIME="${CREATE_A_STATS#* }"
CREATE_B_TIME="${CREATE_B_STATS#* }"
REPLAY_TIME="${REPLAY_STATS#* }"
UPLOAD_TIME="${UPLOAD_STATS#* }"
DOWNLOAD_TIME="${DOWNLOAD_STATS#* }"

python3 - "$RESULT_FILE" "$COMMIT" "$CANONICAL_A" "$CANONICAL_B" "$FILE_ID" "$CREATE_A_TIME" "$CREATE_B_TIME" "$REPLAY_TIME" "$UPLOAD_TIME" "$DOWNLOAD_TIME" <<'PY'
import json,sys,datetime
out,commit,a,b,fid,c1,c2,replay,upload,download=sys.argv[1:11]
payload={
  'ok':True,
  'status':'CERTIFIED_FOR_GUARDED_DEPLOYMENT',
  'certifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'commit':commit,
  'e2e':{
    'firstCanonicalTaskId':a,
    'collisionCanonicalTaskId':b,
    'uploadedFileId':fid,
    'createSeconds':float(c1),
    'collisionCreateSeconds':float(c2),
    'idempotentReplaySeconds':float(replay),
    'upload4MiBSeconds':float(upload),
    'download4MiBSeconds':float(download),
    'downloadHashMatched':True,
    'staleOptimisticIdResolvedToCanonicalTask':True,
    'wrongTaskAttachmentPrevented':True
  }
}
json.dump(payload,open(out,'w'),indent=2)
PY
cp -f "$RESULT_FILE" "$CERTIFIED_RESULT_FILE"
printf '%s\n' "$COMMIT" >"$CERTIFIED_COMMIT_FILE"
printf '%s\n' "$LOG_FILE" >"/root/kalpavriksha-certified-candidate.logpath"

# Cleanup the disposable runtime now; the certification result remains.
cleanup_runtime
trap - EXIT INT TERM ERR

cat "$RESULT_FILE"
echo
echo "======================================================"
echo " KALPAVRIKSHA CANDIDATE CERTIFIED"
echo "======================================================"
echo "Commit: $COMMIT"
echo "Result: $CERTIFIED_RESULT_FILE"
echo "Log:    $LOG_FILE"
echo
echo "NO PRODUCTION CUTOVER WAS PERFORMED."
echo "The live source tree, live PostgreSQL database, live private files, frontend, and PM2 process were not modified."
