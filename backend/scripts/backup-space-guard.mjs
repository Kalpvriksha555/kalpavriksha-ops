import fs from 'node:fs';
import path from 'node:path';

const GiB=1024**3;
const MiB=1024**2;

// Refuse to start a space-heavy snapshot if free space could fall below the
// reserved operating headroom. No deletion or alteration occurs here.
export function projectedBackupBytes({
  storageBytes=0,previousDatabaseBytes=0,databaseOnly=false,filesOnly=false,
  reserveGiB=6
}={}){
  const safe=n=>Number.isFinite(Number(n))&&Number(n)>0?Number(n):0;
  const reserve=Math.max(4,Math.min(32,Number(reserveGiB)||6))*GiB;
  const db=filesOnly?0:Math.max(512*MiB,Math.ceil(safe(previousDatabaseBytes)*1.5));
  // rsync snapshot plus gzip file archive; deliberately assume weak compression.
  const files=databaseOnly?0:Math.ceil(safe(storageBytes)*2.15);
  return Math.ceil(reserve+db+files);
}

function storageSize(root){
  if(!root || !fs.existsSync(root))throw Error('Source storage directory missing');
  let total=0,files=0;
  const scan=(dir)=>{
    for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      const full=path.join(dir,item.name),s=fs.lstatSync(full);
      if(s.isSymbolicLink())continue;
      if(s.isDirectory()){scan(full);continue;}
      if(s.isFile()){total+=s.size;files++;}
    }
  };
  scan(root);
  return {bytes:total,files};
}
function lastVerifiedDatabaseBytes(backupRoot){
  if(!fs.existsSync(backupRoot))return 0;
  let bytes=0;
  for(const name of fs.readdirSync(backupRoot).filter(x=>x.endsWith('.manifest.json'))){
    try{
      const item=JSON.parse(fs.readFileSync(path.join(backupRoot,name),'utf8'));
      if(item.ok===true&&item.status==='VERIFIED')
        bytes=Math.max(bytes,Number(item.components?.database?.sizeBytes)||0);
    }catch{}
  }
  return bytes;
}
export function checkBackupHeadroom({
  backupRoot,storageRoot,databaseOnly=false,filesOnly=false,
  reserveGiB=6,availableBytes=null
}={}){
  if(!backupRoot || !path.isAbsolute(backupRoot))throw Error('Absolute backup root required');
  if(!databaseOnly&&(!storageRoot || !path.isAbsolute(storageRoot)))throw Error('Absolute file root required');
  const capacity=availableBytes===null ? fs.statfsSync(backupRoot).bavail*fs.statfsSync(backupRoot).bsize : Number(availableBytes);
  const src=databaseOnly?{bytes:0,files:0}:storageSize(storageRoot);
  const db=filesOnly?0:lastVerifiedDatabaseBytes(backupRoot);
  const required=projectedBackupBytes({storageBytes:src.bytes,previousDatabaseBytes:db,databaseOnly,filesOnly,reserveGiB});
  const summary={ok:capacity>=required,freeBytes:capacity,requiredBytes:required,
    sourceFileBytes:src.bytes,sourceFileCount:src.files,previousDatabaseBytes:db,
    reserveGiB:Math.max(4,Math.min(32,Number(reserveGiB)||6))};
  if(!summary.ok){
    const error=new Error('BACKUP_SPACE_GUARD: insufficient disk headroom for verified snapshot; no backup started');
    error.code='BACKUP_SPACE_GUARD';
    error.summary=summary;throw error;
  }
  return summary;
}
