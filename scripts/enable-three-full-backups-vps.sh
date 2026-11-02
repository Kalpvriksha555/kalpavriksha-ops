#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
LIVE=/var/www/kalpavriksha-ops
ENV=/etc/kalpavriksha/backend.env
BASE=cb377ff9b7a87dd9c46db599845bbcd140a92713
BRANCH=safety/three-verified-daily-full-backups-20261103
STAGE=$(mktemp -d /var/www/kalpavriksha-three-full.XXXXXXXX)
BACKUP=/var/backups/kalpavriksha-runtime/retention-before-$(date -u +%Y%m%dT%H%M%SZ)
APPLIED=0
SUCCESS=0
finish() {
  rc=$?
  trap - EXIT
  if [ "$SUCCESS" -ne 1 ] && [ "$APPLIED" -eq 1 ]; then
    echo 'Activation failed: restoring backup scripts and settings'
    cp -a "$BACKUP/backup-create.mjs" "$LIVE/backend/scripts/backup-create.mjs"
    cp -a "$BACKUP/auto-storage-retention.mjs" "$LIVE/backend/scripts/auto-storage-retention.mjs"
    cp -a "$BACKUP/backend.env" "$ENV"
    systemctl enable --now kalpavriksha-database-backup.timer >/dev/null || true
  fi
  rm -rf --one-file-system -- "$STAGE"
  exit "$rc"
}
trap finish EXIT
exec 9>/var/lock/kalpavriksha-three-backups.lock
flock -n 9 || exit 1
cd "$LIVE"
# Git HEAD can differ from the actual deployed files after guarded cutovers.
# Match the two live scripts against the exact audited source baseline instead.
# This avoids both unnecessary re-deployment and patching unknown source code.
for file in backend/scripts/backup-create.mjs backend/scripts/auto-storage-retention.mjs; do
  git cat-file -e "$BASE:$file" || { echo "Baseline missing: $file"; exit 1; }
  if ! git show "$BASE:$file" | cmp -s - "$LIVE/$file"; then
    echo "SOURCE_MISMATCH=$file"
    echo "Refusing to overwrite a locally modified backup script."
    echo "LIVE_SHA256=$(sha256sum "$LIVE/$file" | awk '{print $1}')"
    echo "BASE_SHA256=$(git show "$BASE:$file" | sha256sum | awk '{print $1}')"
    exit 1
  fi
done
echo 'BACKUP_SCRIPT_SOURCE_PARITY=PASS'
PID=$(pm2 pid kalpvriksha-backend)
[[ "$PID" =~ ^[0-9]+$ ]] && [ "$PID" -gt 0 ]
tr '\0' '\n' < "/proc/$PID/environ" |
 grep -Eq '^DATABASE_URL=postgres(ql)?://[^@]+@127\.0\.0\.1:5432/kalpvriksha_cutover$'
curl -fsS --max-time 12 https://api.kalpvriksha.co.in/api/health/ready >/dev/null
systemctl is-active --quiet kalpavriksha-backup.timer
systemctl is-enabled --quiet kalpavriksha-backup.timer
for unit in kalpavriksha-backup.service kalpavriksha-database-backup.service; do
  if systemctl is-active --quiet "$unit"; then echo "Backup active: $unit"; exit 1; fi
done
systemctl cat kalpavriksha-backup.service | grep -Fq "$ENV" || { echo 'Full-backup unit must load canonical environment'; exit 1; }
FREE=$(df -PB1 / | awk 'NR==2{print $4}')
[ "$FREE" -ge 21474836480 ] || { echo 'Insufficient reserve'; exit 1; }
set -a; source "$ENV"; set +a
case "$DATABASE_URL" in *'@127.0.0.1:5432/kalpvriksha_cutover') ;; *) echo 'Unexpected production DB'; exit 1;; esac
test -d "$KALPA_BACKUP_ROOT"
(
cd "$LIVE/backend"
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import {verifyManifest} from './scripts/backup-lib.mjs';
const root=process.env.KALPA_BACKUP_ROOT;
const ms=fs.readdirSync(root).filter(x=>x.endsWith('.manifest.json'))
 .map(x=>({p:path.join(root,x),m:JSON.parse(fs.readFileSync(path.join(root,x),'utf8'))}))
 .filter(x=>x.m.backupType==='FULL'&&x.m.status==='VERIFIED'&&x.m.ok===true)
 .sort((a,b)=>Date.parse(b.m.verifiedAt)-Date.parse(a.m.verifiedAt));
if(!ms.length)throw Error('No verified full backup');
const v=verifyManifest(ms[0].p,{verifyContents:true});
if(!v.ok||v.checks.length!==2||v.checks.some(x=>!x.ok||!x.contentReadable))
 throw Error('Full backup contents verification failed');
console.log('EXISTING_FULL_BACKUP=VERIFIED');
NODE
)
git fetch -q origin "$BRANCH"
TARGET=$(git rev-parse FETCH_HEAD)
git merge-base --is-ancestor "$BASE" "$TARGET"
mkdir -p "$STAGE/backend/scripts" "$STAGE/tests/backend"
for file in backend/scripts/backup-create.mjs backend/scripts/auto-storage-retention.mjs tests/backend/backup-three-retention.test.mjs; do
  git show "$TARGET:$file" > "$STAGE/$file"
done
ln -s "$LIVE/backend/scripts/backup-lib.mjs" "$STAGE/backend/scripts/backup-lib.mjs"
node --check "$STAGE/backend/scripts/backup-create.mjs"
node --check "$STAGE/backend/scripts/auto-storage-retention.mjs"
node --test "$STAGE/tests/backend/backup-three-retention.test.mjs"
mkdir -p -m 700 "$BACKUP"
cp -a "$LIVE/backend/scripts/backup-create.mjs" "$BACKUP/"
cp -a "$LIVE/backend/scripts/auto-storage-retention.mjs" "$BACKUP/"
cp -a "$ENV" "$BACKUP/backend.env"
APPLIED=1
install -m 644 "$STAGE/backend/scripts/backup-create.mjs" "$LIVE/backend/scripts/.backup-create.next"
install -m 644 "$STAGE/backend/scripts/auto-storage-retention.mjs" "$LIVE/backend/scripts/.auto-retention.next"
mv -f "$LIVE/backend/scripts/.backup-create.next" "$LIVE/backend/scripts/backup-create.mjs"
mv -f "$LIVE/backend/scripts/.auto-retention.next" "$LIVE/backend/scripts/auto-storage-retention.mjs"
python3 - "$ENV" <<'PY'
from pathlib import Path
from datetime import datetime,timezone
import os,sys
p=Path(sys.argv[1]);txt=p.read_text()
values={
'KALPA_AUTO_BACKUP_ROTATION':'true',
'KALPA_BACKUP_RETENTION_POLICY':'THREE_VERIFIED_DAILY_FULL',
'KALPA_BACKUP_RETENTION_DATABASE':'/kalpvriksha_cutover',
'KALPA_BACKUP_RETENTION_START_AT':datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
lines=[line for line in txt.splitlines() if not any(line.startswith(k+'=') for k in values)]
lines.extend(k+'='+v for k,v in values.items())
new=p.with_name(p.name+'.three-full-next')
with new.open('x') as f:f.write('\n'.join(lines)+'\n')
os.chmod(new,0o600);os.replace(new,p)
PY
systemctl disable --now kalpavriksha-database-backup.timer >/dev/null
(
cd "$LIVE/backend"
set -a; source "$ENV"; set +a
node scripts/backup-create.mjs --dry-run >/dev/null
)
curl -fsS --max-time 12 https://api.kalpvriksha.co.in/api/health/ready >/dev/null
systemctl is-active --quiet kalpavriksha-backup.timer
SUCCESS=1
echo 'THREE_VERIFIED_DAILY_FULL_POLICY=ACTIVATED'
echo 'PREVIOUS_RECOVERY_ARCHIVES=PRESERVED'
echo 'REDUNDANT_DATABASE_ONLY_TIMER=DISABLED'
echo 'PUBLIC_API=PASS'
echo "SCRIPT_ROLLBACK_PATH=$BACKUP"
