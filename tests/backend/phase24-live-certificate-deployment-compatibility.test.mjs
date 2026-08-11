import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const deploy=fs.readFileSync(new URL('../../scripts/deploy-1.9.30-vps.sh',import.meta.url),'utf8');

test('legacy baseline accepts only release-certificate-only readiness degradation',()=>{
  assert.match(deploy,/release_certificate_only_not_ready\(\)/);
  assert.match(deploy,/checks\.get\('releaseCertificate'\) is not False/);
  assert.match(deploy,/if key == 'releaseCertificate'/);
  assert.match(deploy,/if value is not True/);
  assert.match(deploy,/required=\{'shuttingDown','startup','database','privateStorage','diskSpace','backup','persistence'\}/);
  assert.match(deploy,/readiness failure beyond release-certificate validity/);
});

test('certificate-only degraded baseline cannot authorize database integrity reuse',()=>{
  assert.match(deploy,/CURRENT_RUNTIME_READY_PROOF=0/);
  assert.match(deploy,/DATABASE_SOURCE_UNCHANGED.*CURRENT_RUNTIME_READY_PROOF/s);
  assert.match(deploy,/KALPA_REUSE_DATABASE_INTEGRITY=false/);
  assert.match(deploy,/fresh physical PostgreSQL integrity scan/);
});

test('new staging and permanent release still require strict readiness',()=>{
  assert.match(deploy,/wait_for_health "\/api\/health\/ready" "\$WORK\/staging-ready\.json"/);
  assert.match(deploy,/wait_for_health "\/api\/health\/ready" "\$WORK\/ready\.json"/);
  assert.match(deploy,/curl -fsS "http:\/\/127\.0\.0\.1:\$\{PORT\}\/api\/health\/ready"/);
});

test('rollback compatibility does not rewrite the production database',()=>{
  assert.match(deploy,/wait_for_runtime_baseline "\$WORK\/rollback-ready\.json" 45/);
  assert.match(deploy,/Rollback runtime is operationally healthy; readiness is blocked only by its restored release certificate/);
  assert.match(deploy,/Production database was not automatically rewritten/);
});


test('fresh full backup remains mandatory after writes stop and before production certification',()=>{
  const stop=deploy.indexOf('pm2 stop "$PM2_NAME"');
  const create=deploy.indexOf('npm run backup:create | tee "$WORK/pre-deployment-backup.json"');
  const verify=deploy.indexOf('npm run backup:verify | tee "$WORK/pre-deployment-backup-verification.json"');
  const status=deploy.indexOf('npm run backup:status | tee "$WORK/pre-deployment-backup-status.json"');
  const certify=deploy.indexOf('log "Certifying the exact production environment');
  assert.ok(stop >= 0 && create > stop && verify > create && status > verify && certify > status);
  assert.doesNotMatch(deploy,/backup:create\s+--database-only/);
  assert.match(deploy,/Production database was not automatically rewritten/);
});
