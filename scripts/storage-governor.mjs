#!/usr/bin/env node
// Non-destructive storage governor. It MUST NOT prune database files, backups,
// private uploads, legacy uploads or case history. The only supported deletion
// is aged regular files inside the governor's own private scratch directory.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const GiB=1024**3;
export const WORK_ROOT='/var/lib/kalpavriksha/governor/work';
const BACKUP_ROOT='/var/backups/kalpavriksha';
const PROTECTED_ROOT='/var/backups/kalpavriksha-protected-manual';

export function classifyDiskPressure(info,{warnPercent=80,pressurePercent=85,criticalPercent=90,
  minimumFreeGiB=12,criticalFreeGiB=2}={}){
  if(info.usedPercent>=criticalPercent || info.availableBytes<criticalFreeGiB*GiB)return 'CRITICAL';
  if(info.usedPercent>=pressurePercent || info.availableBytes<minimumFreeGiB*GiB)return 'PRESSURE';
  if(info.usedPercent>=warnPercent)return 'WARNING';
  return 'NORMAL';
}
export function readDiskUsage(location='/'){
  const data=fs.statfsSync(location);
  const total=data.blocks*data.bsize,availableBytes=data.bavail*data.bsize;
  const used=(data.blocks-data.bfree)*data.bsize;
  return {totalBytes:total,usedBytes:used,availableBytes,
    usedPercent:total ? Math.round(used/total*10000)/100 : 100,
    availableGiB:Math.round(availableBytes/GiB*100)/100};
}
function backupOverview(){
  const result={manifestCount:0,verifiedCount:0,newestVerifiedAt:null,latestAttemptStatus:null};
  if(!fs.existsSync(BACKUP_ROOT))return {...result,warning:'BACKUP_ROOT_MISSING'};
  const names=fs.readdirSync(BACKUP_ROOT).filter(n=>n.endsWith('.manifest.json'));
  result.manifestCount=names.length;
  const parsed=[];
  for(const name of names){
    try{
      const abs=path.join(BACKUP_ROOT,name);
      const item=JSON.parse(fs.readFileSync(abs,'utf8'));
      parsed.push({createdMs:Date.parse(item.createdAt||'')||fs.statSync(abs).mtimeMs,
        verifiedMs:Date.parse(item.verifiedAt||'')||0,
        status:item.status,ok:item.ok,verification:item.verification});
    }catch{ /* A malformed manifest never authorizes deletion. */ }
  }
  parsed.sort((a,b)=>b.createdMs-a.createdMs);
  result.latestAttemptStatus=parsed[0]?.status||null;
  const verified=parsed.filter(x=>x.status==='VERIFIED'&&x.ok===true&&x.verification?.ok===true);
  result.verifiedCount=verified.length;
  result.newestVerifiedAt=verified.length?new Date(Math.max(...verified.map(x=>x.verifiedMs||x.createdMs))).toISOString():null;
  if(!verified.length)result.warning='NO_VERIFIED_BACKUP_MANIFEST';
  else if(Date.now()-Date.parse(result.newestVerifiedAt)>26*3600000)result.warning='VERIFIED_BACKUP_STALE';
  return result;
}
export function inspectWorkRoot(root=WORK_ROOT){
  if(path.resolve(root)!==WORK_ROOT)throw Error('Work cleanup restricted to one canonical location');
  const parts=[root,path.dirname(root),path.dirname(path.dirname(root)),path.dirname(path.dirname(path.dirname(root)))];
  for(const p of parts){
    if(!fs.existsSync(p))return {exists:false};
    const s=fs.lstatSync(p);
    if(s.isSymbolicLink()||!s.isDirectory())throw Error('Unsafe governor work-root path');
  }
  const s=fs.lstatSync(root);
  if(s.uid!==0 || (s.mode & 0o022)!==0)throw Error('Governor scratch root must be root-owned and not group/world writable');
  if(fs.statSync(path.dirname(root)).dev!==s.dev)throw Error('Governor scratch root is a mount point');
  if(fs.realpathSync(root)!==root)throw Error('Governor scratch directory resolves outside intended path');
  return {exists:true};
}
function listStaleScratch(now=Date.now()){
  const stat=inspectWorkRoot();
  if(!stat.exists)return [];
  const out=[],cutoff=now-7*24*3600000;
  const visit=(directory)=>{
    for(const ent of fs.readdirSync(directory,{withFileTypes:true})){
      const fp=path.join(directory,ent.name);
      const s=fs.lstatSync(fp);
      if(s.isSymbolicLink())continue;
      if(s.isDirectory()){visit(fp);continue;}
      if(!s.isFile()||s.nlink!==1||s.mtimeMs>=cutoff)continue;
      if(/\.(?:partial|pid|lock)$/i.test(ent.name))continue;
      out.push({file:fp,inode:s.ino,size:s.size,mtimeMs:s.mtimeMs});
    }
  };
  visit(WORK_ROOT);return out;
}
export function safeTempCleanup({apply=false,now=Date.now()}={}){
  const files=listStaleScratch(now),removed=[];
  if(apply&&String(process.env.GOVERNOR_ALLOW_TEMP_CLEANUP||'').toLowerCase()!=='true')
    throw Error('Explicit GOVERNOR_ALLOW_TEMP_CLEANUP=true required');
  for(const x of files){
    if(apply){
      const actual=fs.lstatSync(x.file);
      if(!actual.isFile()||actual.isSymbolicLink()||actual.nlink!==1||
        actual.ino!==x.inode||actual.mtimeMs!==x.mtimeMs)continue;
      fs.unlinkSync(x.file);
    }
    removed.push({relative:path.relative(WORK_ROOT,x.file),bytes:x.size});
  }
  return {dryRun:!apply,eligibleOrRemoved:removed.length,bytes:removed.reduce((n,x)=>n+x.bytes,0),files:removed};
}
async function main(){
  const mode=process.argv[2]||'check';
  if(!['check','housekeep','apply-temp'].includes(mode))throw Error('Use check, housekeep or apply-temp');
  const disk=readDiskUsage('/');
  const tier=classifyDiskPressure(disk);
  const backups=backupOverview();
  const report={at:new Date().toISOString(),tier,disk,backups,
    protectedBackupsRoot:PROTECTED_ROOT,automaticBackupPruning:false,
    automaticCustomerFileDeletion:false,mode};
  if(mode!=='check')report.scratch=safeTempCleanup({apply:mode==='apply-temp'});
  process.stdout.write(JSON.stringify(report)+'\n');
  if(tier!=='NORMAL'||backups.warning)
    process.stderr.write('KALPA_STORAGE_WARNING tier='+tier+' backup='+String(backups.warning||'OK')+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{process.stderr.write('GOVERNOR_FAILED '+String(e.message||e)+'\n');process.exitCode=1;});
