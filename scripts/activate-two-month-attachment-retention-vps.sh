#!/usr/bin/env bash
# Activate already-certified, fail-closed two-month attachment retention.
# Never edits case records or deletes uploaded files directly.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run as root on the Kalpvriksha VPS'; exit 1; }
LIVE=/var/www/kalpavriksha-ops
ENV=/etc/kalpavriksha/backend.env
APP=kalpvriksha-backend
[[ -r "$ENV" && -d "$LIVE/backend/src" ]] || exit 1
exec 9>/run/lock/kalpavriksha-attachment-retention-activation.lock
flock -n 9 || { echo 'Another activation is running'; exit 1; }

echo '=== PRODUCTION SAFETY PREFLIGHT ==='
for tool in node pm2 curl python3 systemctl; do command -v "$tool" >/dev/null; done
systemctl is-active --quiet kalpavriksha-backup.timer
systemctl is-enabled --quiet kalpavriksha-backup.timer
PID=$(pm2 pid "$APP")
[[ "$PID" =~ ^[0-9]+$ && "$PID" -gt 0 ]]
curl -fsS --max-time 15 http://127.0.0.1:8080/api/health/ready >/dev/null
curl -fsS --max-time 15 https://api.kalpvriksha.co.in/api/health/ready >/dev/null

# Source must match a certified deployed release. Never bypass this test.
(
  cd "$LIVE"
  set -a
  source "$ENV"
  set +a
  test "$KALPA_BACKUP_RETENTION_POLICY" = 'THREE_VERIFIED_DAILY_FULL'
  test "$KALPA_BACKUP_RETENTION_DATABASE" = '/kalpvriksha_cutover'
  test "$KALPA_BACKUP_ROOT" = '/var/backups/kalpavriksha'
  test -f backend/src/services/fileRetentionBackupReadiness.js
  test -f backend/scripts/file-retention-backup-gate.mjs
  node --input-type=module <<'NODE'
import fs from 'node:fs';
import {sourceTreeHash,readAndVerifyReleaseCertificate,
  runtimeReleaseCertificateDecision} from './backend/src/services/releaseCertificationService.js';
const source=sourceTreeHash(process.cwd());
const ver=JSON.parse(fs.readFileSync('./backend/package.json','utf8')).version;
const result=readAndVerifyReleaseCertificate(process.env.RELEASE_CERTIFICATE_PATH,{
  expectedSourceHash:source.hash,expectedBackendVersion:ver,
  maxAgeHours:Number(process.env.RELEASE_CERTIFICATE_MAX_AGE_HOURS||24),
  requireCleanInstall:true,requireBackup:true
});
const decision=runtimeReleaseCertificateDecision(result,{expectedSourceHash:source.hash});
if(!decision.ok)throw Error('Deployed source has not passed its release certificate');
console.log('RELEASE_SOURCE_CERTIFICATE=PASS');
NODE
  node --test tests/backend/storage-retention-policy.test.mjs tests/backend/two-month-attachment-safety-gate.test.mjs >/dev/null
  echo 'RETENTION_SAFETY_TESTS=PASS'
)

mkdir -p /var/backups/kalpavriksha-runtime
ROLLBACK=/var/backups/kalpavriksha-runtime/file-retention-opt-in-$(date -u +%Y%m%dT%H%M%SZ).env
cp -a "$ENV" "$ROLLBACK"
chmod 600 "$ROLLBACK"
CHANGED=0
SUCCESS=0
rollback(){
  rc=$?
  trap - EXIT
  if [[ "$SUCCESS" != 1 && "$CHANGED" = 1 ]]; then
    cp -a "$ROLLBACK" "$ENV"
    ( set -a; source "$ENV"; set +a; pm2 restart "$APP" --update-env >/dev/null ) || true
    echo 'RESTORED_PRIOR_RETENTION_CONFIGURATION'
  fi
  exit "$rc"
}
trap rollback EXIT

python3 - "$ENV" <<'PY'
from pathlib import Path
import os,sys
p=Path(sys.argv[1])
text=p.read_text()
lines=[line for line in text.splitlines() if not (
 line.startswith('FILE_RETENTION_APPLY=') or line.startswith('FILE_RETENTION_MONTHS=')
)]
lines+=['FILE_RETENTION_APPLY=true','FILE_RETENTION_MONTHS=2']
tmp=p.with_name(p.name+'.retention-activation')
with tmp.open('x') as f:f.write('\n'.join(lines)+'\n')
os.chmod(tmp,0o600)
os.replace(tmp,p)
PY
CHANGED=1
(
  set -a; source "$ENV"; set +a
  pm2 restart "$APP" --update-env >/dev/null
)
sleep 2
curl -fsS --max-time 25 http://127.0.0.1:8080/api/health/ready >/dev/null
curl -fsS --max-time 25 https://api.kalpvriksha.co.in/api/health/ready >/dev/null
PID=$(pm2 pid "$APP")
[[ "$PID" =~ ^[0-9]+$ && "$PID" -gt 0 ]]
tr '\0' '\n' < "/proc/$PID/environ" | grep -qx 'FILE_RETENTION_APPLY=true'
tr '\0' '\n' < "/proc/$PID/environ" | grep -qx 'FILE_RETENTION_MONTHS=2'
SUCCESS=1
echo 'RETENTION_OPT_IN=ACTIVATED'
echo 'TWO_CALENDAR_MONTH_POLICY=ENABLED'
echo 'THREE_VERIFIED_FULL_BACKUP_RUNTIME_GATE=ENABLED'
echo 'UNVERIFIED_BACKUPS_BLOCK_ALL_DELETION=YES'
echo 'PUBLIC_API=READY'
echo "ROLLBACK_CONFIG=$ROLLBACK"
