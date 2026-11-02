import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {rotateVerifiedBackups} from '../../backend/scripts/auto-storage-retention.mjs';

test('retains the latest three full backups and an offsite-pinned older one',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-rotate-'));
  const audit=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-rotate-audit-'));
  const keys=['KALPA_AUTO_BACKUP_ROTATION','KALPA_BACKUP_RETENTION_POLICY',
    'KALPA_BACKUP_RETENTION_START_AT','KALPA_BACKUP_RETENTION_DATABASE',
    'PG_RESTORE_BIN','TAR_BIN'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    process.env.KALPA_AUTO_BACKUP_ROTATION='true';
    process.env.KALPA_BACKUP_RETENTION_POLICY='THREE_VERIFIED_DAILY_FULL';
    process.env.KALPA_BACKUP_RETENTION_START_AT='2026-10-01T00:00:00Z';
    process.env.KALPA_BACKUP_RETENTION_DATABASE='/kalpvriksha_cutover';
    process.env.PG_RESTORE_BIN='/bin/true';
    process.env.TAR_BIN='/bin/true';
    const DAY=86400000, now=Date.UTC(2026,9,18,12), ids=[];
    for(let i=0;i<5;i++){
      const day=String(10+i).padStart(2,'0');
      const id='kv-202610'+day+'T100000Z-'+String(i+1).repeat(8);
      ids.push(id);
      const components={};
      for(const [key,suffix] of [['database','.postgres.dump'],['files','.files.tar.gz']]){
        const bytes=Buffer.from(id+key),file=id+suffix;
        fs.writeFileSync(path.join(root,file),bytes);
        components[key]={file,sizeBytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
      }
      fs.writeFileSync(path.join(root,id+'.manifest.json'),JSON.stringify({
        id,backupType:'FULL',status:'VERIFIED',ok:true,verification:{ok:true},
        application:{databaseIdentity:'/kalpvriksha_cutover',backupPolicy:'three-verified-full-v1'},
        createdAt:new Date(now-(5-i)*DAY).toISOString(),components}));
    }
    const latest=path.join(root,ids[4]+'.manifest.json');
    const d=JSON.parse(fs.readFileSync(latest,'utf8'));
    d.createdAt=new Date(now-300000).toISOString();fs.writeFileSync(latest,JSON.stringify(d));
    fs.writeFileSync(path.join(root,'.backup.lock'),JSON.stringify({pid:process.pid}));
    fs.writeFileSync(path.join(root,'unclassified.postgres.dump'),'do-not-remove');
    const options={freshId:ids[4],now,pinnedId:ids[0],auditRoot:audit};
    const preview=rotateVerifiedBackups(root,options);
    assert.equal(preview.eligible,1);assert.equal(preview.removed,0);
    const applied=rotateVerifiedBackups(root,{...options,apply:true});
    assert.equal(applied.removed,1);
    assert.equal(fs.existsSync(path.join(root,ids[1]+'.manifest.json')),false);
    assert.equal(fs.existsSync(path.join(root,ids[0]+'.files.tar.gz')),true);
    assert.equal(fs.existsSync(path.join(root,'unclassified.postgres.dump')),true);
    assert.equal(fs.existsSync(path.join(audit,ids[1]+'.manifest.json')),true);
  } finally {
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    fs.rmSync(root,{recursive:true,force:true});
    fs.rmSync(audit,{recursive:true,force:true});
  }
});

test('cannot apply without explicit enablement and owner lock',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-rotate-'));
  const p=process.env.KALPA_AUTO_BACKUP_ROTATION;
  delete process.env.KALPA_AUTO_BACKUP_ROTATION;
  try{
    assert.throws(()=>rotateVerifiedBackups(root,{freshId:'kv-20261018T110000Z-eeeeeeee',apply:true}),/opt-in/);
  } finally {
    if(p!==undefined)process.env.KALPA_AUTO_BACKUP_ROTATION=p;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
