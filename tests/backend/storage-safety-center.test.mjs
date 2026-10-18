import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectStorageSafety} from '../../backend/src/services/storageSafetyCenterService.js';

test('counts only intact verified full backups and keeps portal alerts email-free',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-safety-'));
  const recoveryDir=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-restore-'));
  const id='kv-20261018T100000Z-1234abcd', now=Date.UTC(2026,9,18,12);
  try{
    const components={};
    for(const [key,suffix] of [['database','.postgres.dump'],['files','.files.tar.gz']]){
      const file=id+suffix,bytes=Buffer.from(key+id);
      fs.writeFileSync(path.join(root,file),bytes);
      components[key]={file,sizeBytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    }
    fs.writeFileSync(path.join(root,id+'.manifest.json'),JSON.stringify({id,backupType:'FULL',createdAt:new Date(now-3600000).toISOString(),status:'VERIFIED',ok:true,verification:{ok:true},components}));
    const current=inspectStorageSafety({root,recoveryDir,now});
    assert.equal(current.backup.verifiedFullCount,1);
    assert.equal(current.notificationDelivery,'portal-only');
    assert.ok(current.alerts.some(x=>x.id==='DATABASE_BACKUP_STALE'));
    fs.unlinkSync(path.join(root,id+'.files.tar.gz'));
    const missing=inspectStorageSafety({root,recoveryDir,now});
    assert.equal(missing.backup.verifiedFullCount,0);
    assert.ok(missing.alerts.some(x=>x.id==='FULL_BACKUP_STALE'));
  }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(recoveryDir,{recursive:true,force:true});}
});
test('never deletes old partial archives when reporting them',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kalpa-partials-'));
  try{
    const file=path.join(root,'kv-20261018T100000Z-1234abcd.postgres.dump.partial');
    fs.writeFileSync(file,'partial');
    const now=Date.now(),old=new Date(now-3*86400000);
    fs.utimesSync(file,old,old);
    const r=inspectStorageSafety({root,recoveryDir:path.join(root,'nonexistent'),now});
    assert.equal(r.backup.stalePartialCount,1);
    assert.equal(fs.existsSync(file),true);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('routes require Admin session and fail-closed opt-in; no email or dangerous API actions',()=>{
  const s=fs.readFileSync(new URL('../../backend/src/server.js',import.meta.url),'utf8');
  const start=s.indexOf('// Storage Safety Centre:');
  const end=s.indexOf("app.get('/api/system/release-certification'",start);
  assert.ok(start>0 && end>start);
  const routes=s.slice(start,end);
  assert.match(routes,/requireAdminSession/);
  assert.match(routes,/KALPA_STORAGE_PORTAL_ACTIONS_ENABLED/);
  assert.match(routes,/SAFE_SCRATCH_CLEANUP/);
  assert.doesNotMatch(routes,/sendMail|sendEmail|DELETE_FILES|RESTORE_DATABASE/);
  assert.doesNotMatch(routes,/execSync|\beval\s*\(/);
});
