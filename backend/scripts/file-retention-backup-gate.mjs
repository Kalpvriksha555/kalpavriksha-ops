#!/usr/bin/env node
// Fail-closed, read-only safety gate for two-calendar-month attachment expiry.
// This file never mutates PostgreSQL, uploaded objects, or backup archives.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyManifest} from './backup-lib.mjs';

const BACKUP_ID=/^kv-\d{8}T\d{6}Z-[a-f0-9]{8}$/;
const MAX_NEWEST_AGE_MS=36*60*60*1000;
const MAX_OLDEST_AGE_MS=5*24*60*60*1000;
const tag='three-verified-full-v1';

const regular = fp => {
  const s=fs.lstatSync(fp);
  return s.isFile()&&!s.isSymbolicLink()&&s.nlink===1;
};

export function inspectRetentionBackupGate({
  root=process.env.KALPA_BACKUP_ROOT,
  now=Date.now(),
  verify=verifyManifest,
  verifyContents=true,
  expectedRoot='/var/backups/kalpavriksha'
}={}){
  const fail=reason=>({ok:false,reason,checked:0});
  const canonical=path.resolve(expectedRoot);
  if(!root||path.resolve(root)!==canonical) return fail('CANONICAL_BACKUP_ROOT_REQUIRED');
  if(process.env.KALPA_BACKUP_RETENTION_POLICY!=='THREE_VERIFIED_DAILY_FULL')
    return fail('THREE_FULL_RETENTION_POLICY_REQUIRED');
  if(process.env.KALPA_BACKUP_RETENTION_DATABASE!=='/kalpvriksha_cutover')
    return fail('LOCAL_PRODUCTION_DATABASE_REQUIRED');
  if(process.env.FILE_RETENTION_MONTHS && process.env.FILE_RETENTION_MONTHS!=='2')
    return fail('TWO_MONTH_RETENTION_REQUIRED');
  const cutoff=Date.parse(process.env.KALPA_BACKUP_RETENTION_START_AT||'');
  if(!Number.isFinite(cutoff)||cutoff<=0)return fail('VALID_BACKUP_ACTIVATION_TIME_REQUIRED');
  let stat;
  try{stat=fs.lstatSync(root);}catch{return fail('BACKUP_ROOT_MISSING');}
  if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(root)!==canonical)
    return fail('BACKUP_ROOT_NOT_CANONICAL');
  let records=[];
  try{
    for(const filename of fs.readdirSync(root)){
      if(!filename.endsWith('.manifest.json'))continue;
      const fp=path.join(root,filename);
      if(!regular(fp))return fail('NON_REGULAR_BACKUP_MANIFEST');
      const m=JSON.parse(fs.readFileSync(fp,'utf8'));
      if(m.application?.backupPolicy!==tag)continue; // Historical backups never count.
      if(m.application?.databaseIdentity!=='/kalpvriksha_cutover'||
         m.backupType!=='FULL'||m.ok!==true||m.status!=='VERIFIED'||
         m.verification?.ok!==true||!BACKUP_ID.test(m.id)||
         filename!==m.id+'.manifest.json')
        return fail('INVALID_TAGGED_FULL_BACKUP');
      const at=Date.parse(m.createdAt||'');
      if(!Number.isFinite(at)||at<cutoff||at>now)
        return fail('TAGGED_BACKUP_DATE_INVALID');
      records.push({id:m.id,createdAt:at,fp,m});
    }
  }catch{return fail('BACKUP_MANIFEST_PARSE_FAILED');}
  records.sort((a,b)=>b.createdAt-a.createdAt);
  if(records.length<3)return fail('AWAITING_THREE_NEW_VERIFIED_FULL_BACKUPS');
  const selected=records.slice(0,3);
  if(now-selected[0].createdAt>MAX_NEWEST_AGE_MS)
    return fail('LATEST_FULL_BACKUP_STALE');
  if(now-selected[2].createdAt>MAX_OLDEST_AGE_MS)
    return fail('THREE_FULL_BACKUPS_NOT_RECENT');
  const days=new Set(selected.map(x=>new Date(x.createdAt).toISOString().slice(0,10)));
  if(days.size!==3)return fail('THREE_DISTINCT_BACKUP_DAYS_REQUIRED');
  for(const record of selected){
    const m=record.m;
    if(Object.keys(m.components||{}).sort().join(',')!=='database,files')
      return fail('FULL_BACKUP_COMPONENTS_MISSING');
    for(const [key,ext] of [['database','.postgres.dump'],['files','.files.tar.gz']]){
      const item=m.components[key];
      if(!item||item.file!==m.id+ext||!(Number(item.sizeBytes)>0)||
         !/^[a-f0-9]{64}$/.test(item.sha256||''))
        return fail('FULL_BACKUP_COMPONENT_METADATA_INVALID');
      try{
        const fp=path.join(root,item.file);
        if(!regular(fp)||fs.statSync(fp).size!==Number(item.sizeBytes))
          return fail('FULL_BACKUP_COMPONENT_MISSING_OR_CHANGED');
      }catch{return fail('FULL_BACKUP_COMPONENT_MISSING_OR_CHANGED');}
    }
    let result;
    try{result=verify(record.fp,{verifyContents});}
    catch{return fail('FULL_BACKUP_CONTENTS_VERIFICATION_ERROR');}
    if(!result.ok||result.checks?.length!==2||
       !result.checks.every(c=>c.ok===true&&c.contentReadable===true))
      return fail('FULL_BACKUP_CONTENTS_UNVERIFIED');
  }
  return {ok:true,reason:'THREE_RECENT_INDEPENDENT_FULL_BACKUPS_VERIFIED',
    checked:3,newestAt:new Date(selected[0].createdAt).toISOString(),
    oldestAt:new Date(selected[2].createdAt).toISOString()};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=inspectRetentionBackupGate();
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.ok)process.exitCode=3;
}
