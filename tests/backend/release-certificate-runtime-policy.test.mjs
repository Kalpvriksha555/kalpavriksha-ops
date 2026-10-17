import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReleaseCertificate, verifyReleaseCertificate, runtimeReleaseCertificateDecision
} from '../../backend/src/services/releaseCertificationService.js';

function certified(overrides={}) {
  return createReleaseCertificate({
    appVersion:'1.9.30',backendVersion:'2.9.30',sourceHash:'source-hash-A',sourceFileCount:463,
    checks:[{id:'clean-verify',status:'PASS'}],
    cleanInstall:{status:'PASS'},backup:{status:'VERIFIED',ok:true},...overrides
  });
}
function verify(cert, opts={}) {
  return verifyReleaseCertificate(cert,{
    expectedBackendVersion:'2.9.30',expectedSourceHash:'source-hash-A',
    requireCleanInstall:true,requireBackup:true,...opts
  });
}
test('fresh certified exact source is accepted',()=>{
  const cert=certified(),decision=runtimeReleaseCertificateDecision(verify(cert),{expectedSourceHash:'source-hash-A'});
  assert.equal(decision.ok,true);assert.equal(decision.stale,false);
});
test('expiry alone becomes runtime warning only for byte-identical certified source',()=>{
  const cert=certified();
  const checked=verify(cert,{now:Date.now()+72*3600000});
  assert.ok(checked.failures.includes('Certificate is expired.'));
  const decision=runtimeReleaseCertificateDecision(checked,{expectedSourceHash:'source-hash-A'});
  assert.equal(decision.ok,true);
  assert.equal(decision.stale,true);
  assert.match(decision.warning,/recertify/i);
});
test('a new deployed source requires fresh matching certification',()=>{
  const checked=verify(certified(),{expectedSourceHash:'source-hash-B',now:Date.now()+72*3600000});
  assert.equal(runtimeReleaseCertificateDecision(checked,{expectedSourceHash:'source-hash-B'}).ok,false);
});
test('tampering with signed certificate is never treated as ordinary staleness',()=>{
  const original=certified(),tampered={...original,sourceHash:'forged'};
  assert.equal(runtimeReleaseCertificateDecision(verify(tampered,{now:Date.now()+72*3600000}),
    {expectedSourceHash:'source-hash-A'}).ok,false);
});
test('failed checks and missing verified backups remain fatal after expiry',()=>{
  const invalid=certified({checks:[{id:'test',status:'FAIL'}]});
  const missingBackup=certified({backup:{status:'FAILED',ok:false}});
  for(const certificate of [invalid,missingBackup]){
    assert.equal(runtimeReleaseCertificateDecision(verify(certificate,{now:Date.now()+72*3600000}),
      {expectedSourceHash:'source-hash-A'}).ok,false);
  }
});
test('missing identity hash never bypasses certification gate',()=>{
  const checked=verify(certified());
  assert.equal(runtimeReleaseCertificateDecision(checked,{expectedSourceHash:''}).ok,false);
});
test('mismatched backend version cannot be bypassed by age allowance',()=>{
  const checked=verify(certified(),{expectedBackendVersion:'2.9.31',now:Date.now()+72*3600000});
  assert.equal(runtimeReleaseCertificateDecision(checked,{expectedSourceHash:'source-hash-A'}).ok,false);
});
