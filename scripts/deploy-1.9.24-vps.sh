#!/usr/bin/env bash
set -Eeuo pipefail

LIVE="${KALPA_LIVE_ROOT:-/var/www/kalpavriksha-ops}"
STAGE="${KALPA_STAGE_ROOT:-/var/www/kalpavriksha-release-1.9.24}"
ENV_FILE="${KALPA_ENV_FILE:-/etc/kalpavriksha/backend.env}"
PM2_NAME="${KALPA_PM2_NAME:-kalpvriksha-backend}"
WORK="${KALPA_DEPLOY_WORK:-/root/kalpavriksha-deploy-$(date +%Y%m%d-%H%M%S)}"
ROLLBACK_ROOT="$WORK/previous-runtime"
ROLLBACK_CWD="$ROLLBACK_ROOT/backend"
ROLLBACK_SCRIPT=""

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

pre_deployment_failure() {
  local rc=$?
  trap - ERR INT TERM
  echo
  echo "PRE-DEPLOYMENT VERIFICATION FAILED WITH CODE $rc"
  echo "The live backend was not stopped and operational business data was not modified."
  echo "A verified backup record may have been created by the pre-deployment matrix."
  echo "Review every failing gate reported above before retrying."
  exit "$rc"
}
trap pre_deployment_failure ERR INT TERM

log "Checking production paths and tools"
test -d "$LIVE/.git" || fail "Git repository missing at $LIVE"
test -s "$ENV_FILE" || fail "Environment file missing at $ENV_FILE"
for command_name in git node npm pm2 curl python3 tar; do
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

OLD_RELATIVE_SCRIPT="$(python3 - "$OLD_CWD" "$OLD_SCRIPT" <<'PYREL'
import os,sys
cwd=os.path.realpath(sys.argv[1])
script=os.path.realpath(sys.argv[2])
rel=os.path.relpath(script,cwd)
if rel == '..' or rel.startswith('../'):
    raise SystemExit(2)
print(rel)
PYREL
)" || fail "Current PM2 script is outside its working directory and cannot be snapshotted safely"

log "Capturing an immutable rollback runtime before staging"
rm -rf "$ROLLBACK_ROOT"
mkdir -p "$ROLLBACK_CWD"
cp -a "$OLD_CWD/." "$ROLLBACK_CWD/"
ROLLBACK_SCRIPT="$ROLLBACK_CWD/$OLD_RELATIVE_SCRIPT"
test -f "$ROLLBACK_SCRIPT" || fail "Rollback backend script snapshot is missing"
node --check "$ROLLBACK_SCRIPT"

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

grep -q "spoofedIdempotentReplay" "$STAGE/scripts/phase-4-authorization-check.mjs" || \
  fail "GitHub main does not contain the authorization-before-idempotency runtime probe"

grep -q "managerEchoEdit" "$STAGE/scripts/phase-4-authorization-check.mjs" || \
  fail "GitHub main does not contain the server-mutation-metadata replay regression probe"

grep -q "status:'Assigned'" "$STAGE/scripts/phase-4-authorization-check.mjs" || \
  fail "GitHub main does not contain the authorization verifier lifecycle-safe assignment correction"

grep -q "function assertProjectUpdateAuthorized" "$STAGE/backend/src/server.js" || \
  fail "GitHub main does not contain authorization-before-version task protection"

grep -q "spoofedBroadStateUpdate.payload?.code === 'TASK_UPDATE_FORBIDDEN'" "$STAGE/scripts/phase-4-authorization-check.mjs" || \
  fail "GitHub main does not contain both authorization-precedence runtime probes"

grep -q "COLLECT FILE STORAGE GARBAGE" "$STAGE/scripts/phase-6-file-storage-check.mjs" || \
  fail "GitHub main does not contain the grace-period file garbage-collection verifier"

grep -q "acquireLease:true" "$STAGE/backend/src/server.js" || \
  fail "GitHub main does not hold upload leases through request persistence"

grep -q "FILE_STORAGE_GC_GRACE_MS" "$STAGE/backend/src/server.js" || \
  fail "GitHub main does not contain grace-period file garbage collection"

grep -q "safeCountMetadataDrift" "$STAGE/backend/scripts/db-integrity-audit.mjs" || \
  fail "GitHub main does not contain count-only relational integrity classification"

grep -q "REPAIR VERIFIED LEGACY INTEGRITY METADATA" "$STAGE/backend/scripts/db-integrity-repair.mjs" || \
  fail "GitHub main does not contain guarded legacy integrity repair"

grep -q "mergeVerifiedPhysicalCounts" "$STAGE/backend/src/repositories/postgresStateRepository.js" || \
  fail "GitHub main does not verify metadata counts against transactional physical rows"

log "Auditing release source ordering and syntax"

bash -n "$STAGE/scripts/deploy-1.9.24-vps.sh"

node --input-type=module - "$STAGE" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const server = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
const verifier = fs.readFileSync(path.join(root, 'scripts/phase-4-authorization-check.mjs'), 'utf8');
const taskService = fs.readFileSync(path.join(root, 'frontend/src/services/taskService.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
const matrix = fs.readFileSync(path.join(root, 'scripts/full-release-verifier-matrix.mjs'), 'utf8');
const fileStorage = fs.readFileSync(path.join(root, 'backend/src/services/fileStorageService.js'), 'utf8');
const fileVerifier = fs.readFileSync(path.join(root, 'scripts/phase-6-file-storage-check.mjs'), 'utf8');
const repository = fs.readFileSync(path.join(root, 'backend/src/repositories/postgresStateRepository.js'), 'utf8');
const integrityAudit = fs.readFileSync(path.join(root, 'backend/scripts/db-integrity-audit.mjs'), 'utf8');
const integrityRepair = fs.readFileSync(path.join(root, 'backend/scripts/db-integrity-repair.mjs'), 'utf8');
const securityAudit = fs.readFileSync(path.join(root, 'scripts/security-package-audit.mjs'), 'utf8');
const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-1.9.24-vps.sh'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const assertBefore = (block, first, second, label) => {
  const firstIndex = block.indexOf(first);
  const secondIndex = block.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    throw new Error(`${label}: authorization must appear before task-version validation.`);
  }
};

const dedicatedStart = server.indexOf("app.post('/api/state/projects'");
const dedicatedEnd = server.indexOf("app.delete('/api/state/projects", dedicatedStart);
if (dedicatedStart < 0 || dedicatedEnd < 0) throw new Error('Dedicated task route could not be located.');
const dedicatedBlock = server.slice(dedicatedStart, dedicatedEnd);
assertBefore(
  dedicatedBlock,
  'assertProjectUpdateAuthorized(existing, req)',
  "existing.lastTaskMutationId || '') === mutationId",
  'Dedicated task idempotency route'
);
assertBefore(
  dedicatedBlock,
  "existing.lastTaskMutationId || '') === mutationId",
  'assertExpectedTaskVersion(existing, incoming, req.body || {})',
  'Dedicated task version route'
);

const broadStart = server.indexOf("app.post('/api/state', async");
const broadEnd = server.indexOf("app.post('/api/notifications", broadStart);
if (broadStart < 0 || broadEnd < 0) throw new Error('Legacy broad-state route could not be located.');
assertBefore(
  server.slice(broadStart, broadEnd),
  'assertProjectUpdateAuthorized(existing,req)',
  'assertExpectedTaskVersion(existing,incoming,incoming)',
  'Legacy broad-state route'
);

for (const marker of [
  'Deliberately omit expectedTaskVersion here',
  "spoofedOtherUpdate.payload?.code === 'TASK_UPDATE_FORBIDDEN'",
  "spoofedBroadStateUpdate.payload?.code === 'TASK_UPDATE_FORBIDDEN'",
  'spoofedIdempotentReplay',
  'managerEchoEdit'
]) {
  if (!verifier.includes(marker)) throw new Error(`Authorization verifier marker is missing: ${marker}`);
}


const mutationStart = server.indexOf('function taskMutationId');
const mutationEnd = server.indexOf('function completedTaskDocuments', mutationStart);
if (mutationStart < 0 || mutationEnd < 0) throw new Error('Task mutation helper could not be located.');
const mutationBlock = server.slice(mutationStart, mutationEnd);
if (mutationBlock.includes('lastTaskMutationId')) throw new Error('Server-owned lastTaskMutationId is still accepted as a client mutation ID.');
if (!mutationBlock.includes('body.mutationId') || !mutationBlock.includes('incoming.clientMutationId')) throw new Error('Explicit client mutation-ID inputs are missing.');
if (taskService.includes("mutationId || normalizedTask.lastTaskMutationId")) throw new Error('Frontend task API still recycles server-owned mutation metadata.');
const pendingStart = app.indexOf('const rememberPendingCreatedProject');
const pendingEnd = app.indexOf('const markPendingCreatedAttempt', pendingStart);
if (pendingStart < 0 || pendingEnd < 0) throw new Error('Durable task outbox helper could not be located.');
if (app.slice(pendingStart, pendingEnd).includes('project.lastTaskMutationId')) throw new Error('Durable task outbox still inherits a server-owned mutation ID.');


const requiredMatrixMarkers = [
  'security-package-audit', 'doctor', 'regression-guard', 'production-audit',
  'frontend-tests', 'backend-tests', 'finance', 'authentication',
  'authorization', 'database', 'files', 'reliability', 'release',
  'frontend-ux', 'integration', 'build', 'clean-install',
  'production-environment', 'production-integrity-audit', 'backup-create', 'backup-verify', 'backup-status'
];
for (const marker of requiredMatrixMarkers) {
  if (!matrix.includes(`id:'${marker}'`)) throw new Error(`Full verifier matrix is missing ${marker}.`);
}
if (!matrix.includes('for (const step of steps) results.push(await runStep(step))')) throw new Error('Full verifier matrix is not configured to continue through all gates.');
if (!matrix.includes("const failures = results.filter(item => item.status !== 'PASS')")) throw new Error('Full verifier matrix does not aggregate failures.');
if (!matrix.includes('KALPA_VERIFY_INCLUDE_DEPLOYMENT_GATES')) throw new Error('Full verifier matrix cannot include clean-install, environment, and backup gates.');
if (pkg.scripts?.['verify:matrix'] !== 'node scripts/full-release-verifier-matrix.mjs') throw new Error('verify:matrix package command is missing or changed.');

for (const marker of ['acquireLease', 'hasActiveLease', 'leaseMaxAgeMs']) {
  if (!fileStorage.includes(marker)) throw new Error(`File-storage lease protection is missing ${marker}.`);
}
for (const marker of ['COLLECT FILE STORAGE GARBAGE', 'retained-shared-object', 'movedToTrash>=1']) {
  if (!fileVerifier.includes(marker)) throw new Error(`Phase 6 verifier marker is missing: ${marker}`);
}
const gcStart = server.indexOf('async function collectFileStorageGarbage');
const gcEnd = server.indexOf("app.post('/api/system/files/garbage-collect'", gcStart);
if (gcStart < 0 || gcEnd < 0) throw new Error('Grace-period file garbage collector could not be located.');
const gcBlock = server.slice(gcStart, gcEnd);
if (gcBlock.indexOf('activeFileStorageKeys(readDb())') < 0 || gcBlock.indexOf('fileStorage.hasActiveLease(key)') < 0 || gcBlock.indexOf('fileStorage.softDelete(key') < 0) {
  throw new Error('File garbage collection is missing its final reference/lease checks or recoverable trash move.');
}
if (gcBlock.indexOf('activeFileStorageKeys(readDb())') > gcBlock.indexOf('fileStorage.softDelete(key')) {
  throw new Error('File garbage collection must recheck active references before moving an object.');
}
for (const marker of ['auditRelationalIntegrityMetadata', 'reconcileRelationalIntegrityMetadata', 'mergeVerifiedPhysicalCounts', 'RELATIONAL_SHADOW_DIVERGENCE']) {
  if (!repository.includes(marker)) throw new Error(`Relational integrity hardening marker is missing: ${marker}`);
}
if (!integrityAudit.includes('LEGACY_SHADOW_REBASELINE_REQUIRED') || !integrityAudit.includes('UNSAFE_INTEGRITY_DRIFT')) throw new Error('Production integrity audit does not classify guarded legacy shadow drift.');
for (const marker of ['REPAIR VERIFIED LEGACY INTEGRITY METADATA', 'verifyManifest', 'legacyShadowRebaselineSafe', 'recent verified full backup']) {
  if (!integrityRepair.includes(marker)) throw new Error(`Integrity repair safeguard is missing: ${marker}`);
}
const migrateIndex=deploy.indexOf('npm run db:migrate --prefix backend');
const repairIndex=deploy.indexOf('npm run db:integrity:repair --prefix backend');
const strictIntegrityIndex=deploy.indexOf('npm run db:integrity --prefix backend');
if (migrateIndex < 0 || repairIndex < 0 || strictIntegrityIndex < 0 || !(migrateIndex < repairIndex && repairIndex < strictIntegrityIndex)) {
  throw new Error('Deployment must migrate, perform guarded integrity repair, then run strict integrity.');
}
if (!deploy.includes('ROLLBACK_SCRIPT="$ROLLBACK_CWD/$OLD_RELATIVE_SCRIPT"')) throw new Error('Deployment does not snapshot an immutable rollback runtime.');
const certificationIndex = deploy.lastIndexOf('\nnpm run release:certify');
const generatedBuildCleanupIndex = deploy.lastIndexOf('rm -rf "$STAGE/frontend/dist"', certificationIndex);
if (certificationIndex < 0 || generatedBuildCleanupIndex < 0 || generatedBuildCleanupIndex >= certificationIndex) {
  throw new Error('Deployment must remove verifier-generated frontend output before release certification.');
}
for (const marker of ['gitTrackedFiles', "['ls-files', '-z']", 'isBundledGeneratedArtifact']) {
  if (!securityAudit.includes(marker)) throw new Error(`Security package audit build-origin safeguard is missing: ${marker}`);
}

console.log('Release authorization, idempotency, file-GC, relational-integrity, certification-ordering, rollback, and full-matrix source audit passed.');
NODE

while IFS= read -r -d '' source_file; do
  node --check "$source_file" >/dev/null
done < <(find "$STAGE/scripts" "$STAGE/backend/src" "$STAGE/backend/scripts" "$STAGE/tests" \
  -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -print0)

log "Installing clean staging dependencies"
cd "$STAGE"
rm -rf node_modules backend/node_modules frontend/node_modules frontend/dist .release release-certification.json
npm ci --include=dev --no-audit --no-fund
npm ci --prefix frontend --include=dev --no-audit --no-fund

log "Running the complete verification matrix (all failures are collected before aborting)"
KALPA_VERIFY_INCLUDE_DEPLOYMENT_GATES=true KALPA_VERIFY_MATRIX_REPORT="$WORK/full-verifier-matrix.json" npm run verify:matrix

log "All code, clean-install, environment, and backup gates passed before downtime"

CERTIFICATE_BACKUP="$WORK/previous-release-certification.json"
HAD_OLD_CERTIFICATE=0
if [ -f "$RELEASE_CERTIFICATE_PATH" ]; then
  cp "$RELEASE_CERTIFICATE_PATH" "$CERTIFICATE_BACKUP"
  HAD_OLD_CERTIFICATE=1
fi

trap - ERR INT TERM

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
  pm2 start "$ROLLBACK_SCRIPT" --name "$PM2_NAME" --cwd "$ROLLBACK_CWD" --time --update-env || true
  if wait_for_health "/api/health/live" "$WORK/rollback-live-health.json"; then
    wait_for_health "/api/health/ready" "$WORK/rollback-ready-health.json" || true
  else
    echo "WARNING: rollback runtime did not pass the liveness check; inspect PM2 logs immediately." >&2
  fi
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

log "Repairing only verified legacy relational integrity metadata"
KALPA_INTEGRITY_REPAIR_CONFIRM="REPAIR VERIFIED LEGACY INTEGRITY METADATA" \
npm run db:integrity:repair --prefix backend | tee "$WORK/relational-integrity-repair.json"

log "Checking strict relational database integrity after repair"
npm run db:integrity --prefix backend | tee "$WORK/relational-integrity-after-reconciliation.json"

log "Certifying the exact production release"
# The pre-downtime matrix intentionally builds the frontend. Certification
# begins with a source-package audit, so remove only that generated output;
# release:certify rebuilds the exact frontend immediately afterward.
rm -rf "$STAGE/frontend/dist"
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
