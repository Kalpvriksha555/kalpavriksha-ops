import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const scriptPath=fileURLToPath(new URL('../../scripts/activate-two-month-attachment-retention-vps.sh',import.meta.url));
const script=fs.readFileSync(scriptPath,'utf8');
const start=script.indexOf('wait_for_api_readiness() {');
const end=script.indexOf('\n# Source must match a certified deployed release.',start);
assert.ok(start>0 && end>start,'bounded readiness loop must precede any production mutation');
const waitFunction=script.slice(start,end);

test('activation guard remains shell-parseable and verifies certified live source before mutation',()=>{
  const r=spawnSync('bash',['-n',scriptPath],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(script,/RELEASE_SOURCE_CERTIFICATE=PASS/);
  assert.match(script,/RETENTION_SAFETY_TESTS=PASS/);
  assert.match(script,/systemctl is-active --quiet kalpavriksha-backup.timer/);
  assert.match(script,/PREVIOUS_RETENTION_FLAG_STILL_ACTIVE/);
});

test('readiness probe tolerates initially refused port instead of aborting after two seconds',()=>{
  const shell='set -Eeuo pipefail\nATTEMPT=0\n'+
    'curl(){ if [[ "$*" == *"127.0.0.1:8080"* ]]; then ATTEMPT=$((ATTEMPT + 1)); fi; ((ATTEMPT >= 4)); }\n'+
    'sleep(){ :; }\n'+waitFunction+'\nwait_for_api_readiness';
  const r=spawnSync('bash',['-c',shell],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/API_READINESS=PASS \(attempt=4\)/);
});

test('readiness eventually fails rather than claiming success if API never returns',()=>{
  const shell='set -Eeuo pipefail\ncurl(){ return 7; }\nsleep(){ :; }\n'+waitFunction+'\nwait_for_api_readiness';
  const r=spawnSync('bash',['-c',shell],{encoding:'utf8'});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/API_READINESS=FAILED/);
});

test('rollback explicitly clears PM2 apply flag, restores env, and waits for recovered readiness',()=>{
  assert.match(script,/cp -a "\$ROLLBACK" "\$ENV"/);
  assert.match(script,/export FILE_RETENTION_APPLY=false/);
  assert.match(script,/pm2 restart "\$APP" --update-env/);
  assert.match(script,/ROLLBACK_BACKEND_READINESS=PASS/);
  assert.match(script,/wait_for_api_readiness\nPID=\$\(pm2 pid/);
  assert.match(script,/UNVERIFIED_BACKUPS_BLOCK_ALL_DELETION=YES/);
});
