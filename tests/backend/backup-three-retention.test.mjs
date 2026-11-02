import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rotateVerifiedBackups } from '../../backend/scripts/auto-storage-retention.mjs';

function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-three-full-'));
  fs.chmodSync(root,0o700);
  const prior={
    KALPA_BACKUP_RETENTION_POLICY:process.env.KALPA_BACKUP_RETENTION_POLICY,
    KALPA_BACKUP_RETENTION_START_AT:process.env.KALPA_BACKUP_RETENTION_START_AT,
    KALPA_BACKUP_ROOT:process.env.KALPA_BACKUP_ROOT
  };
  t.after(()=>{
    for(const [key,value] of Object.entries(prior)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    fs.rmSync(root,{recursive:true,force:true});
  });
  delete process.env.KALPA_BACKUP_ROOT;
  const make=(day,props={})=>{
    const date=new Date(Date.UTC(2026,10,3+day,0,0,0));
    const stamp=date.toISOString().replace(/[-:]/g,'').replace(/\.000Z/,'Z');
    const id='kv-'+stamp+'-12345678';
    const file=path.join(root,id+'.manifest.json');
    fs.writeFileSync(file,JSON.stringify({
      id,backupType:'FULL',status:'VERIFIED',ok:true,
      verification:{ok:true,checks:[]},
      application:{backupPolicy:'three-verified-full-v1',databaseIdentity:'/kalpvriksha_cutover'},
      createdAt:date.toISOString(),components:{},
      ...props
    }));
    return {id,file};
  };
  return {root,make};
}
test('rotation is disabled unless specifically opted in', t=>{
  const {root,make}=setup(t);
  const latest=make(1);
  delete process.env.KALPA_BACKUP_RETENTION_POLICY;
  assert.equal(rotateVerifiedBackups(root,{freshId:latest.id}).removed,0);
  assert.equal(rotateVerifiedBackups(root,{freshId:latest.id}).skipped,'THREE_FULL_RETENTION_NOT_ENABLED');
});
test('migration cutoff is mandatory even when enabled',t=>{
  const {root,make}=setup(t);const latest=make(1);
  process.env.KALPA_BACKUP_RETENTION_POLICY='THREE_VERIFIED_DAILY_FULL';
  delete process.env.KALPA_BACKUP_RETENTION_START_AT;
  assert.equal(rotateVerifiedBackups(root,{freshId:latest.id}).skipped,'VALID_RETENTION_START_REQUIRED');
});
test('old and foreign database manifests are never counted or retired',t=>{
  const {root,make}=setup(t);
  process.env.KALPA_BACKUP_RETENTION_POLICY='THREE_VERIFIED_DAILY_FULL';
  process.env.KALPA_BACKUP_RETENTION_START_AT='2026-11-02T18:00:00Z';
  const a=make(-10,{createdAt:'2026-10-20T00:00:00Z'});
  const b=make(0,{application:{backupPolicy:'three-verified-full-v1',databaseIdentity:'/other'}});
  const c=make(1);
  assert.equal(rotateVerifiedBackups(root,{freshId:c.id,now:Date.UTC(2026,10,4,0,0,0)}).skipped,'NEED_THREE_VERIFIED_FULL_BACKUPS');
  assert.ok(fs.existsSync(a.file));
  assert.ok(fs.existsSync(b.file));
  assert.ok(fs.existsSync(c.file));
});
