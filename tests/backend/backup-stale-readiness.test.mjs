import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {backupReadinessDecision} from '../../backend/src/services/operationalReliabilityService.js';

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-stale-backup-'));
  const components={
    database:{file:'one.postgres.dump',sizeBytes:4,sha256:'fake-hash'},
    files:{file:'one.files.tar.gz',sizeBytes:4,sha256:'fake-hash'}
  };
  for(const c of Object.values(components))fs.writeFileSync(path.join(root,c.file),'data');
  const item={status:'VERIFIED',ok:true,verification:{ok:true},backupType:'FULL',components};
  return {root,manifest:item,backups:{ok:false,status:'STALE',latestVerified:item}};
}
test('stale full backup is warning, not a healthy-app outage',()=>{
  const t=fixture();
  try{
    const x=backupReadinessDecision(t.backups,{backupRoot:t.root});
    assert.equal(x.ok,true);assert.equal(x.stale,true);assert.match(x.warning,/recovery point/);
  }finally{fs.rmSync(t.root,{recursive:true,force:true});}
});
test('missing or mismatched backup components remain fatal',()=>{
  const t=fixture();
  try{
    fs.rmSync(path.join(t.root,'one.files.tar.gz'));
    assert.equal(backupReadinessDecision(t.backups,{backupRoot:t.root}).ok,false);
    fs.writeFileSync(path.join(t.root,'one.files.tar.gz'),'truncated-file');
    assert.equal(backupReadinessDecision(t.backups,{backupRoot:t.root}).ok,false);
  }finally{fs.rmSync(t.root,{recursive:true,force:true});}
});
test('missing, failed or uncertified backup manifests remain fatal',()=>{
  const t=fixture();
  try{
    for(const change of [{ok:false},{verification:{ok:false}},{backupType:'DATABASE'}]){
      assert.equal(backupReadinessDecision({ok:false,status:'STALE',latestVerified:{...t.manifest,...change}},
        {backupRoot:t.root}).ok,false);
    }
    assert.equal(backupReadinessDecision({ok:false,status:'MISSING',latestVerified:null},{backupRoot:t.root}).ok,false);
  }finally{fs.rmSync(t.root,{recursive:true,force:true});}
});
