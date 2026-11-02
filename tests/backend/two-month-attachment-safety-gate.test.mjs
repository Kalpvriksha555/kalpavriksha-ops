import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectRetentionBackupGate} from '../../backend/scripts/file-retention-backup-gate.mjs';
import {applyFileRetentionToState,shouldExpireFile} from '../../backend/src/services/storageRetentionService.js';

const GiB=1024**3;
const NOW=Date.parse('2026-11-06T03:00:00Z');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-file-retention-gate-'));
  const before=Object.fromEntries([
    'KALPA_BACKUP_RETENTION_POLICY','KALPA_BACKUP_RETENTION_DATABASE',
    'KALPA_BACKUP_RETENTION_START_AT','FILE_RETENTION_MONTHS'
  ].map(key=>[key,process.env[key]]));
  t.after(()=>{
    fs.rmSync(dir,{recursive:true,force:true});
    for(const [key,value] of Object.entries(before)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });
  process.env.KALPA_BACKUP_RETENTION_POLICY='THREE_VERIFIED_DAILY_FULL';
  process.env.KALPA_BACKUP_RETENTION_DATABASE='/kalpvriksha_cutover';
  process.env.KALPA_BACKUP_RETENTION_START_AT='2026-11-02T20:00:00Z';
  process.env.FILE_RETENTION_MONTHS='2';
  function put(date,overrides={}){
    const stamp=date.replace(/[-:]/g,'').replace('.000Z','Z');
    const id='kv-'+stamp+'-abc12345';
    const db=id+'.postgres.dump',files=id+'.files.tar.gz';
    fs.writeFileSync(path.join(dir,db),'complete database fixture');
    fs.writeFileSync(path.join(dir,files),'complete files fixture');
    const manifest={id,createdAt:date,backupType:'FULL',status:'VERIFIED',
      ok:true,verification:{ok:true,checks:[]},
      application:{databaseIdentity:'/kalpvriksha_cutover',backupPolicy:'three-verified-full-v1'},
      components:{
        database:{file:db,sizeBytes:25,sha256:'a'.repeat(64)},
        files:{file:files,sizeBytes:22,sha256:'b'.repeat(64)}
      },...overrides};
    // Actual test files must be size-consistent with metadata.
    manifest.components.database.sizeBytes=fs.statSync(path.join(dir,db)).size;
    manifest.components.files.sizeBytes=fs.statSync(path.join(dir,files)).size;
    fs.writeFileSync(path.join(dir,id+'.manifest.json'),JSON.stringify(manifest));
    return {id,db,files};
  }
  const verify=(p,{verifyContents}={})=>({
    ok:verifyContents===true,checks:[{ok:true,contentReadable:true},{ok:true,contentReadable:true}]
  });
  const check=(options={})=>inspectRetentionBackupGate({
    root:dir,expectedRoot:dir,now:NOW,verify,...options
  });
  return{dir,put,check};
}
const day=n=>new Date(NOW-n*24*60*60*1000).toISOString().replace(/\.\d{3}Z$/,'Z');

test('retention remains blocked until three distinct complete backups exist',t=>{
  const x=fixture(t);
  assert.equal(x.check().reason,'AWAITING_THREE_NEW_VERIFIED_FULL_BACKUPS');
  x.put(day(0));x.put(day(1));
  assert.equal(x.check().reason,'AWAITING_THREE_NEW_VERIFIED_FULL_BACKUPS');
  x.put(day(2));
  assert.equal(x.check().ok,true);
});
test('a missing current files archive aborts retention readiness',t=>{
  const x=fixture(t);
  x.put(day(0));x.put(day(1));const damaged=x.put(day(2));
  fs.unlinkSync(path.join(x.dir,damaged.files));
  assert.equal(x.check().reason,'FULL_BACKUP_COMPONENT_MISSING_OR_CHANGED');
});
test('stale backup chains are not accepted',t=>{
  const x=fixture(t);
  // Make the activation date older than the stale fixtures, so this tests
  // recency rather than the separate pre-activation exclusion.
  process.env.KALPA_BACKUP_RETENTION_START_AT='2026-10-01T00:00:00Z';
  x.put(day(2));x.put(day(3));x.put(day(4));
  assert.equal(x.check().reason,'LATEST_FULL_BACKUP_STALE');
});
test('archive verification errors fail closed',t=>{
  const x=fixture(t);x.put(day(0));x.put(day(1));x.put(day(2));
  const result=x.check({verify:()=>({ok:false,checks:[]})});
  assert.equal(result.reason,'FULL_BACKUP_CONTENTS_UNVERIFIED');
});
test('unrelated Supabase-era backups do not count',t=>{
  const x=fixture(t);x.put(day(0));x.put(day(1));
  x.put(day(2),{application:{databaseIdentity:'/supabase',backupPolicy:'legacy'}});
  assert.equal(x.check().reason,'AWAITING_THREE_NEW_VERIFIED_FULL_BACKUPS');
});
test('finance, statutory and legal evidence remain exempt from case expiry',()=>{
  const C={id:'c1',status:'COMPLETED',completedAt:'2026-08-01T00:00:00Z',documents:[]};
  const file=id=>({id,caseId:'c1',uploadedAt:'2026-07-01T00:00:00Z',
    storageKey:'objects/'+id,purpose:'SOURCE'});
  const normal=file('ordinary');
  const docs=[
    {...file('legal'),category:'legal evidence'},
    {...file('statutory'),documentType:'statutory'},
    {...file('compliance'),classification:'compliance'},
    {...file('invoice'),folder:'invoice'},
    {...file('finance'),purpose:'SOURCE'}
  ];
  const s={cases:[C],files:[normal,...docs],payments:[],
    financeHistory:[{reference:{fileId:'finance'}}],teamChat:[]};
  const result=applyFileRetentionToState(s,{nowMs:NOW});
  assert.deepEqual(result.expiredIds,['ordinary']);
  assert.equal(s.cases[0].status,'COMPLETED');
  assert.equal(s.financeHistory[0].reference.fileId,'finance');
});
test('reopened cases, legal holds, and archives with recent closure retain attachments',()=>{
  const doc={id:'file',caseId:'c1',purpose:'SOURCE',
    uploadedAt:'2026-03-01T00:00:00Z',storageKey:'objects/file'};
  const check=record=>shouldExpireFile(doc,{
    state:{files:[doc],cases:[{id:'c1',...record}],payments:[],teamChat:[]},nowMs:NOW
  });
  assert.equal(check({status:'REOPENED_FOR_REVISION',completedAt:'2026-01-01T00:00:00Z'}),false);
  assert.equal(check({status:'ARCHIVED',archivedAt:'2026-07-01T00:00:00Z',legalHold:true}),false);
  assert.equal(check({status:'ARCHIVED',archivedAt:'2026-10-01T00:00:00Z'}),false);
  assert.equal(check({status:'ARCHIVED',archivedAt:'2026-08-01T00:00:00Z'}),true);
  assert.equal(check({status:'COMPLETED',completedAt:'2026-02-01T00:00:00Z',
    archived:true,archivedAt:null}),false);
});
