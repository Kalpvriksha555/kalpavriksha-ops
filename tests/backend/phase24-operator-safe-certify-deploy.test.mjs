import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(p)=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const launcher=read('scripts/launch-certify-and-deploy-1.9.30-vps.sh');
const orchestrator=read('scripts/certify-and-deploy-1.9.30-vps.sh');
const push=read('PUSH_AND_DEPLOY.md');
const deployDoc=read('DEPLOY_1.9.30.md');

test('current operator docs cannot direct production to obsolete 1.9.24 deployer',()=>{
  for(const doc of [push,deployDoc]) {
    assert.doesNotMatch(doc,/deploy-1\.9\.24-vps\.sh/);
    assert.match(doc,/launch-certify-and-deploy-1\.9\.30-vps\.sh/);
  }
});

test('final wrapper survives SSH disconnect and proves exact GitHub candidate outside live source',()=>{
  assert.match(launcher,/Never launch final certification from the live source path/);
  assert.match(launcher,/ls-remote origin refs\/heads\/main/);
  assert.match(launcher,/CURRENT_COMMIT/);
  assert.match(launcher,/REMOTE_COMMIT/);
  assert.match(launcher,/systemd-run/);
  assert.match(launcher,/TimeoutStartSec=0/);
  assert.match(launcher,/KillMode=control-group/);
  assert.match(launcher,/kalpavriksha-final-release-last-unit/);
});

test('entire integrated certification and deployment lifecycle is overlap locked',()=>{
  assert.match(orchestrator,/KALPA_FINAL_RELEASE_LOCK/);
  assert.match(orchestrator,/exec 9>>"\$FINAL_RELEASE_LOCK"/);
  assert.match(orchestrator,/flock -n 9/);
  assert.match(orchestrator,/Another Kalpavriksha final certification\/deployment pipeline is already running/);
});

test('current deployment documentation names the exact current release',()=>{
  assert.match(deployDoc,/1\.9\.30-ssh-independent-certify-deploy-closure/);
  assert.match(deployDoc,/2\.9\.30-ssh-independent-certify-deploy-closure/);
  assert.doesNotMatch(deployDoc,/runtime-persistence-recovery/);
});
