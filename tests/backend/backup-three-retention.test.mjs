import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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
  // A new-policy backup must contain both independently checkable components.
  // The earlier empty fixture was correctly rejected as malformed.
  const complete=JSON.parse(fs.readFileSync(c.file,'utf8'));
  complete.components={};
  for(const [key,suffix] of [['database','.postgres.dump'],['files','.files.tar.gz']]){
    const filename=c.id+suffix;
    const bytes=Buffer.from('test complete '+c.id+' '+key);
    fs.writeFileSync(path.join(root,filename),bytes);
    complete.components[key]={file:filename,sizeBytes:bytes.length,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  }
  fs.writeFileSync(c.file,JSON.stringify(complete));
  assert.equal(rotateVerifiedBackups(root,{freshId:c.id,now:Date.UTC(2026,10,4,0,0,0)}).skipped,'NEED_THREE_VERIFIED_FULL_BACKUPS');
  assert.ok(fs.existsSync(a.file));
  assert.ok(fs.existsSync(b.file));
  assert.ok(fs.existsSync(c.file));
});

test('four complete backups rotate to three only after verified replacements',t=>{
  const {root,make}=setup(t);
  const oldEnv=Object.fromEntries(['KALPA_AUTO_BACKUP_ROTATION','PG_RESTORE_BIN','TAR_BIN']
    .map(k=>[k,process.env[k]]));
  t.after(()=>{for(const [k,v] of Object.entries(oldEnv)){
    if(v===undefined)delete process.env[k];else process.env[k]=v;
  }});
  process.env.KALPA_BACKUP_RETENTION_POLICY='THREE_VERIFIED_DAILY_FULL';
  process.env.KALPA_BACKUP_RETENTION_START_AT='2026-11-01T00:00:00Z';
  process.env.KALPA_AUTO_BACKUP_ROTATION='true';
  process.env.PG_RESTORE_BIN='/bin/true'; // Unit-test stub; runtime uses real pg_restore.
  process.env.TAR_BIN='/bin/true'; // Unit-test stub; runtime uses real tar.
  const fixtures=[];
  for(const day of [-1,0,1,2]){
    const created=make(day);
    const m=JSON.parse(fs.readFileSync(created.file,'utf8'));
    const components={};
    for(const [key,suffix] of [['database','.postgres.dump'],['files','.files.tar.gz']]){
      const filename=created.id+suffix;
      const bytes=Buffer.from('test recovery '+created.id+' '+key);
      fs.writeFileSync(path.join(root,filename),bytes);
      components[key]={file:filename,sizeBytes:bytes.length,
        sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    }
    m.components=components;
    fs.writeFileSync(created.file,JSON.stringify(m));
    fixtures.push(created);
  }
  const fresh=fixtures.at(-1);
  const at=Date.UTC(2026,10,5,0,30,0);
  const keep=fixtures.slice(-3);
  const retirement=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-retired-'));
  t.after(()=>fs.rmSync(retirement,{recursive:true,force:true}));
  // A dry run must show the intended candidate without changing any bytes.
  const plan=rotateVerifiedBackups(root,{freshId:fresh.id,apply:false,now:at,auditRoot:retirement});
  assert.equal(plan.eligible,1);
  assert.equal(plan.removed,0);
  assert.ok(fs.existsSync(fixtures[0].file));
  // Applying requires the active backup-create owner lock.
  assert.throws(()=>rotateVerifiedBackups(root,{freshId:fresh.id,apply:true,now:at,auditRoot:retirement}),/lock|ENOENT/i);
  fs.writeFileSync(path.join(root,'.backup.lock'),JSON.stringify({pid:process.pid}));
  // A corrupt RETAINED recovery point must abort before removing anything.
  const damaged=path.join(root,keep[0].id+'.files.tar.gz');
  fs.appendFileSync(damaged,'corruption');
  assert.throws(()=>rotateVerifiedBackups(root,{freshId:fresh.id,apply:true,now:at,auditRoot:retirement}));
  assert.ok(fs.existsSync(fixtures[0].file));
  // Restore sample file and apply.
  const bytes=Buffer.from('test recovery '+keep[0].id+' files');
  fs.writeFileSync(damaged,bytes);
  const result=rotateVerifiedBackups(root,{freshId:fresh.id,apply:true,now:at,auditRoot:retirement});
  assert.equal(result.removed,1);
  assert.equal(fs.existsSync(fixtures[0].file),false);
  assert.ok(fs.existsSync(path.join(retirement,fixtures[0].id+'.manifest.json')));
  for(const x of keep) assert.ok(fs.existsSync(x.file));
});
