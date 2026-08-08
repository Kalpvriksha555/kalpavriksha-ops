import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { atomicJson, commandExists, ensureDir, fileMeta, isoStamp, pruneBackups, recordBackupRun, run, verifyManifest } from './backup-lib.mjs';

const args=new Set(process.argv.slice(2));
const dryRun=args.has('--dry-run');
const databaseOnly=args.has('--database-only');
const filesOnly=args.has('--files-only');
if(databaseOnly&&filesOnly)throw new Error('Choose only one of --database-only or --files-only.');
const databaseUrl=String(process.env.DATABASE_URL||'').trim();
const storageRoot=path.resolve(process.env.KALPA_FILE_STORAGE_ROOT||'');
const backupRoot=path.resolve(process.env.KALPA_BACKUP_ROOT||path.join(process.cwd(),'backups'));
const retentionDays=Number(process.env.BACKUP_RETENTION_DAYS||30);
const retentionCount=Number(process.env.BACKUP_RETENTION_COUNT||30);
const rsyncBin=process.env.RSYNC_BIN||'rsync';
const tarBin=process.env.TAR_BIN||'tar';
const snapshotAttempts=Math.max(2,Math.min(10,Number(process.env.BACKUP_FILE_SNAPSHOT_ATTEMPTS||4)));
const snapshotExclude=String(process.env.BACKUP_FILE_SNAPSHOT_EXCLUDE||'/temp/***').trim();
const within=(child,parent)=>{const relative=path.relative(path.resolve(parent),path.resolve(child));return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));};
if(!filesOnly&&!/^postgres(ql)?:\/\//i.test(databaseUrl))throw new Error('DATABASE_URL is required for database backup.');
if(!databaseOnly&&(!process.env.KALPA_FILE_STORAGE_ROOT||!fs.existsSync(storageRoot)))throw new Error('KALPA_FILE_STORAGE_ROOT must point to existing private file storage.');
if(!filesOnly&&!commandExists(process.env.PG_DUMP_BIN||'pg_dump'))throw new Error('pg_dump is not installed or not in PATH.');
if(!databaseOnly&&!commandExists(tarBin))throw new Error('tar is not installed or not in PATH.');
if(!databaseOnly&&!commandExists(rsyncBin))throw new Error('rsync is required for deterministic private-file snapshots.');
if(!databaseOnly&&within(backupRoot,storageRoot))throw new Error('KALPA_BACKUP_ROOT must not be inside KALPA_FILE_STORAGE_ROOT.');
ensureDir(backupRoot);
const lockPath=path.join(backupRoot,'.backup.lock');
const staleLockMs=Math.max(5 * 60 * 1000,Number(process.env.BACKUP_STALE_LOCK_MS || 2 * 60 * 60 * 1000));
const processAlive=(pid)=>{try{process.kill(Number(pid),0);return true;}catch{return false;}};
if(fs.existsSync(lockPath)){
  let existing={};
  try{existing=JSON.parse(fs.readFileSync(lockPath,'utf8'));}catch{}
  const lockAge=Date.now()-Number(existing.startedAtMs || fs.statSync(lockPath).mtimeMs || 0);
  if((existing.pid && processAlive(existing.pid)) || lockAge < staleLockMs) throw new Error(`Another backup appears to be running (${lockPath}).`);
  fs.rmSync(lockPath,{force:true});
}
let lockFd;
try{
  lockFd=fs.openSync(lockPath,'wx',0o600);
  fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),startedAtMs:Date.now()}));
  fs.fsyncSync(lockFd);
}catch{throw new Error(`Another backup appears to be running (${lockPath}).`);}
const startedAt=new Date().toISOString();
const stamp=isoStamp();
const id=`kv-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
const prefix=path.join(backupRoot,id);
const manifestPath=`${prefix}.manifest.json`;
const snapshotRoot=`${prefix}.files.snapshot`;
const manifest={schemaVersion:2,id,backupType:databaseOnly?'DATABASE':filesOnly?'FILES':'FULL',status:'STARTED',ok:false,createdAt:startedAt,completedAt:null,verifiedAt:null,host:process.env.HOSTNAME||'',components:{},verification:{ok:false,checks:[]},application:{phase:7,state:'relational-production'},notes:'Created atomically from PostgreSQL plus a verified converged private-file snapshot by Kalpavriksha backup-create.mjs'};

function snapshotRsyncArgs({dry=false,itemize=false}={}){
  const source=`${storageRoot.replace(/\/$/,'')}/`;
  const destination=`${snapshotRoot.replace(/\/$/,'')}/`;
  const result=['-a','--delete','--checksum'];
  if(snapshotExclude)result.push(`--exclude=${snapshotExclude}`);
  if(dry)result.push('--dry-run');
  if(itemize)result.push('--itemize-changes','--out-format=%i %n%L');
  result.push('--',source,destination);
  return result;
}

function createStablePrivateFileSnapshot(){
  fs.rmSync(snapshotRoot,{recursive:true,force:true});
  ensureDir(snapshotRoot);
  for(let attempt=1;attempt<=snapshotAttempts;attempt+=1){
    console.error(`[backup] private file snapshot sync ${attempt}/${snapshotAttempts}: ${id}`);
    run(rsyncBin,snapshotRsyncArgs(),{stdio:'inherit',timeoutMs:Number(process.env.BACKUP_FILES_SNAPSHOT_TIMEOUT_MS || 30 * 60 * 1000)});
    const verification=run(rsyncBin,snapshotRsyncArgs({dry:true,itemize:true}),{stdio:'pipe',timeoutMs:Number(process.env.BACKUP_FILES_SNAPSHOT_VERIFY_TIMEOUT_MS || 30 * 60 * 1000)});
    const drift=String(verification.stdout||'').trim();
    if(!drift){
      console.error(`[backup] private file snapshot stable: ${id}`);
      return;
    }
    const sample=drift.split(/\r?\n/u).filter(Boolean).slice(0,10).join(' | ');
    console.error(`[backup] private file source changed during snapshot attempt ${attempt}: ${sample}`);
  }
  const error=new Error(`Private file storage did not stabilize after ${snapshotAttempts} snapshot attempts.`);
  error.code='BACKUP_FILE_SNAPSHOT_UNSTABLE';
  throw error;
}

try{
  if(dryRun){console.log(JSON.stringify({ok:true,dryRun:true,id,backupRoot,database:!filesOnly,files:!databaseOnly,fileSnapshotStrategy:databaseOnly?'none':'rsync-converged-snapshot'},null,2));process.exitCode=0;}
  else{
    if(!filesOnly){
      const final=`${prefix}.postgres.dump`;const partial=`${final}.partial`;
      console.error(`[backup] database export started: ${id}`);
      run(process.env.PG_DUMP_BIN||'pg_dump',['--format=custom','--compress=6','--no-owner','--no-acl','--file',partial,databaseUrl],{stdio:'inherit',timeoutMs:Number(process.env.BACKUP_DATABASE_TIMEOUT_MS || 10 * 60 * 1000)});
      fs.renameSync(partial,final);manifest.components.database=fileMeta(final);
      console.error(`[backup] database export completed: ${manifest.components.database.sizeBytes} bytes`);
    }
    if(!databaseOnly){
      const final=`${prefix}.files.tar.gz`;const partial=`${final}.partial`;
      console.error(`[backup] private file snapshot started: ${id}`);
      createStablePrivateFileSnapshot();
      console.error(`[backup] private file archive started from stable snapshot: ${id}`);
      run(tarBin,['-czf',partial,'-C',snapshotRoot,'.'],{stdio:'inherit',timeoutMs:Number(process.env.BACKUP_FILES_TIMEOUT_MS || 30 * 60 * 1000)});
      fs.renameSync(partial,final);manifest.components.files=fileMeta(final);
      console.error(`[backup] private file archive completed: ${manifest.components.files.sizeBytes} bytes`);
    }
    manifest.status='CREATED';manifest.completedAt=new Date().toISOString();atomicJson(manifestPath,manifest);
    const verification=verifyManifest(manifestPath,{verifyContents:true});
    manifest.verification={ok:verification.ok,checks:verification.checks};manifest.ok=verification.ok;manifest.status=verification.ok?'VERIFIED':'FAILED';manifest.verifiedAt=new Date().toISOString();atomicJson(manifestPath,manifest);
    await recordBackupRun(databaseUrl,{id,backupType:manifest.backupType,status:manifest.status,manifestPath,databaseFile:manifest.components.database?.file||'',filesArchive:manifest.components.files?.file||'',databaseSha256:manifest.components.database?.sha256||'',filesSha256:manifest.components.files?.sha256||'',sizeBytes:Object.values(manifest.components).reduce((n,item)=>n+Number(item.sizeBytes||0),0),details:{verification:manifest.verification,fileSnapshotStrategy:databaseOnly?'none':'rsync-converged-snapshot'},startedAt,completedAt:manifest.completedAt,verifiedAt:manifest.verifiedAt});
    const removed=pruneBackups(backupRoot,{retentionDays,retentionCount});
    console.log(JSON.stringify({ok:manifest.ok,id,status:manifest.status,manifestPath,components:manifest.components,fileSnapshotStrategy:databaseOnly?'none':'rsync-converged-snapshot',removed},null,2));
    if(!manifest.ok)process.exitCode=2;
  }
}catch(error){
  for(const partial of [`${prefix}.postgres.dump.partial`,`${prefix}.files.tar.gz.partial`])try{fs.rmSync(partial,{force:true});}catch{}
  manifest.status='FAILED';manifest.ok=false;manifest.completedAt=new Date().toISOString();manifest.error=error.message||String(error);try{atomicJson(manifestPath,manifest);}catch{}
  await recordBackupRun(databaseUrl,{id,backupType:manifest.backupType,status:'FAILED',manifestPath,details:{error:manifest.error},startedAt,completedAt:manifest.completedAt}).catch(()=>{});
  console.error(JSON.stringify({ok:false,id,error:manifest.error,manifestPath},null,2));process.exitCode=1;
}finally{
  try{fs.rmSync(snapshotRoot,{recursive:true,force:true});}catch{}
  try{if(lockFd!==undefined)fs.closeSync(lockFd);}catch{}
  try{fs.rmSync(lockPath,{force:true});}catch{}
}
