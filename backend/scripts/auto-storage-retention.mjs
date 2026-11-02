import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifyManifest} from './backup-lib.mjs';

// Restricted post-verification rotation. No unverified, shared, orphan, partial,
// protected-manual, customer or live-database files may be removed.
const BACKUP_ID=/^kv-\d{8}T\d{6}Z-[a-f0-9]{8}$/;
const HASH=/^[a-f0-9]{64}$/;
const DAY=86400000;
const requireRegular=(p,size)=>{
  const s=fs.lstatSync(p);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||
     (size!==undefined&&s.size!==size))throw Error('Unexpected file: '+p);
  return s;
};
const hashFile=p=>{
  const h=crypto.createHash('sha256'),fd=fs.openSync(p,'r'),buf=Buffer.allocUnsafe(1048576);
  try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));}
  finally{fs.closeSync(fd);}
  return h.digest('hex');
};
function auditedCopy(source,target){
  const bytes=fs.readFileSync(source);
  if(fs.existsSync(target)){
    if(!fs.readFileSync(target).equals(bytes))throw Error('Audit conflict: '+target);
    return;
  }
  const fd=fs.openSync(target,'wx',0o600);
  try{fs.writeSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(!fs.readFileSync(target).equals(bytes))throw Error('Audit mismatch');
}
function components(m){
  const specs=m.backupType==='FULL'?[['database','.postgres.dump'],['files','.files.tar.gz']]:
    m.backupType==='DATABASE'?[['database','.postgres.dump']]:[];
  if(!specs.length||Object.keys(m.components||{}).length!==specs.length)return null;
  const out=[];
  for(const [key,suffix] of specs){
    const c=m.components?.[key];
    if(!c||c.file!==m.id+suffix||!HASH.test(c.sha256)||
       !Number.isSafeInteger(Number(c.sizeBytes))||Number(c.sizeBytes)<1)return null;
    out.push({name:c.file,size:Number(c.sizeBytes),sha:c.sha256});
  }
  return out;
}
export function rotateVerifiedBackups(root,{freshId,apply=false,now=Date.now(),
  pinnedId='',auditRoot='/var/lib/kalpavriksha/backup-retirement'}={}){
  root=path.resolve(root);
  const rootStat=fs.lstatSync(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||fs.realpathSync(root)!==root)
    throw Error('Unsafe backup root');
  if(!BACKUP_ID.test(String(freshId||'')))throw Error('Verified full-backup identity missing');
  if(apply){
    if(process.env.KALPA_AUTO_BACKUP_ROTATION!=='true')throw Error('Rotation opt-in missing');
    const lock=JSON.parse(fs.readFileSync(path.join(root,'.backup.lock'),'utf8'));
    if(Number(lock.pid)!==process.pid)throw Error('Exclusive backup owner lock missing');
  }
  // Opt-in is independent of historical backup-rotation flags. Never allow
  // previously created full backups, migration archives, or manual snapshots
  // to enter the automatic-deletion candidate set.
  if(process.env.KALPA_BACKUP_RETENTION_POLICY!=='THREE_VERIFIED_DAILY_FULL')
    return {ok:true,skipped:'THREE_FULL_RETENTION_NOT_ENABLED',removed:0};
  const cutoff=Date.parse(process.env.KALPA_BACKUP_RETENTION_START_AT||'');
  if(!Number.isFinite(cutoff)||cutoff<=0)
    return {ok:true,skipped:'VALID_RETENTION_START_REQUIRED',removed:0};
  const dbIdentity=String(process.env.KALPA_BACKUP_RETENTION_DATABASE||'/kalpvriksha_cutover');
  if(dbIdentity!=='/kalpvriksha_cutover')
    return {ok:true,skipped:'PRODUCTION_DATABASE_IDENTITY_REQUIRED',removed:0};
  if(process.env.KALPA_BACKUP_ROOT&&path.resolve(process.env.KALPA_BACKUP_ROOT)!==root)
    throw Error('Backup root differs from the production backup root');
  const all=[],refs=new Map();
  for(const name of fs.readdirSync(root)){
    if(!name.endsWith('.manifest.json'))continue;
    const fp=path.join(root,name);
    requireRegular(fp);
    const m=JSON.parse(fs.readFileSync(fp,'utf8'));
    for(const c of Object.values(m.components||{})){
      const f=typeof c?.file==='string'?c.file:'';
      if(f)refs.set(f,(refs.get(f)||0)+1);
    }
    if(!BACKUP_ID.test(m.id)||name!==m.id+'.manifest.json'||
       m.status!=='VERIFIED'||m.ok!==true||m.verification?.ok!==true)continue;
    // Only post-activation backups that explicitly identify the local
    // PostgreSQL production database are eligible. Historical migrations
    // and earlier Supabase-era backups remain outside automated retirement.
    if(m.backupType!=='FULL'||m.application?.backupPolicy!=='three-verified-full-v1'||
       m.application?.databaseIdentity!==dbIdentity||
       !Number.isFinite(Date.parse(m.createdAt||''))||
       Date.parse(m.createdAt)<cutoff)continue;
    const parts=components(m),date=Date.parse(m.createdAt||'');
    // A new-policy VERIFIED manifest with a damaged or missing component
    // is an error, not an invisible entry to filter out. Otherwise a
    // corrupted newest backup can make an older one appear to be the
    // third good backup, masking a broken recovery point.
    if(!parts||!Number.isFinite(date)||date>now)
      throw Error('Malformed new-policy full backup manifest: '+m.id);
    for(const c of parts){
      try{requireRegular(path.join(root,c.name),c.size);}
      catch{throw Error('Incomplete or damaged new-policy full backup: '+m.id+' / '+c.name);}
    }
    all.push({id:m.id,type:m.backupType,date,parts,manifest:fp});
  }
  const full=all.filter(x=>x.type==='FULL').sort((a,b)=>b.date-a.date);
  if(full.length<3)return {ok:true,skipped:'NEED_THREE_VERIFIED_FULL_BACKUPS',removed:0};
  if(full[0].id!==freshId||now-full[0].date>3600000)
    return {ok:true,skipped:'FRESH_VERIFIED_FULL_BACKUP_MISSING',removed:0};
  // A pinned historical backup may intentionally live outside this policy's
  // candidate set. Never require it to be retired or to count as one of three.
  const keep=new Set(full.slice(0,3).map(x=>x.id));
  if(pinnedId)keep.add(pinnedId);
  // Verify ALL three replacement full restore points independently,
  // including archive readability (pg_restore list + tar contents). Never
  // delete an old copy if one of the retained full copies is incomplete.
  for(const x of full.filter(x=>keep.has(x.id))){
    const verified=verifyManifest(x.manifest,{verifyContents:true});
    if(!verified.ok||verified.checks.length!==2||
       !verified.checks.every(c=>c.ok&&c.contentReadable===true))
      throw Error('Replacement full backup failed content verification: '+x.id);
    for(const c of x.parts)if(hashFile(path.join(root,c.name))!==c.sha)
      throw Error('Retained recovery checksum mismatch: '+x.id);
  }
  // Only retire OLD full backups created by this policy. Database-only,
  // migration, legacy, manual, and pre-activation backups are excluded.
  const eligible=all.filter(x=>x.type==='FULL'&&!keep.has(x.id)&&
    now-x.date>=2*DAY&&x.parts.every(c=>refs.get(c.name)===1));
  const result={ok:true,dryRun:!apply,kept:[...keep],eligible:eligible.length,
    expectedBytes:eligible.reduce((n,x)=>n+x.parts.reduce((v,c)=>v+c.size,0),0),
    removed:0,bytesFreed:0};
  if(!apply||!eligible.length)return result;
  auditRoot=path.resolve(auditRoot);
  if(auditRoot===root||auditRoot.startsWith(root+path.sep))throw Error('Unsafe audit root');
  fs.mkdirSync(auditRoot,{recursive:true,mode:0o700});
  if(fs.lstatSync(auditRoot).isSymbolicLink()||fs.realpathSync(auditRoot)!==auditRoot)
    throw Error('Invalid audit directory');
  if(fs.statSync(root).ino!==rootStat.ino||fs.statSync(root).dev!==rootStat.dev)
    throw Error('Backup root changed');
  for(const x of eligible){
    const oldVerified=verifyManifest(x.manifest,{verifyContents:true});
    if(!oldVerified.ok||oldVerified.checks.length!==2)throw Error('Old full backup verification failed: '+x.id);
    auditedCopy(x.manifest,path.join(auditRoot,x.id+'.manifest.json'));
    for(const c of x.parts){
      requireRegular(path.join(root,c.name),c.size);
      if(hashFile(path.join(root,c.name))!==c.sha)throw Error('Candidate checksum mismatch: '+x.id);
    }
    const intent=path.join(auditRoot,x.id+'.retirement-intent.json');
    const fd=fs.openSync(intent,'wx',0o600);
    try{fs.writeSync(fd,JSON.stringify({id:x.id,at:new Date().toISOString(),files:x.parts}));fs.fsyncSync(fd);}
    finally{fs.closeSync(fd);}
    for(const c of x.parts){
      requireRegular(path.join(root,c.name),c.size);
      fs.unlinkSync(path.join(root,c.name));
      result.bytesFreed+=c.size;
    }
    fs.unlinkSync(x.manifest);
    result.removed++;
  }
  return result;
}

// Only older workspaces generated by our own deployer, never generic directories.
export function cleanOldReleaseWorkspaces({apply=false,now=Date.now()}={}){
  if(apply&&process.env.KALPA_AUTO_RELEASE_CLEANUP!=='true')throw Error('Release cleanup opt-in missing');
  const root='/root',live='/var/www/kalpavriksha-ops';
  const receipt=JSON.parse(fs.readFileSync('/root/kalpavriksha-final-deployment.result.json','utf8'));
  if(receipt.ok!==true||receipt.status!=='DEPLOYED_AND_PUBLICLY_VERIFIED'||
     !/^[a-f0-9]{40}$/.test(receipt.commit||''))throw Error('No verified public release');
  const call=(program,args)=>{
    const r=spawnSync(program,args,{encoding:'utf8',timeout:15000,maxBuffer:4*1048576});
    if(r.status!==0)throw Error('Unhealthy production or unavailable tool: '+program);
    return r.stdout;
  };
  const apps=JSON.parse(call('pm2',['jlist']));
  const backend=apps.find(x=>x.name==='kalpvriksha-backend');
  if(!backend||backend.pm2_env?.status!=='online'||
     backend.pm2_env?.pm_cwd!==live+'/backend'||
     backend.pm2_env?.pm_exec_path!==live+'/backend/src/server.js')throw Error('PM2 path not permanent');
  call('curl',['-fsS','--max-time','10','http://127.0.0.1:8080/api/health/ready']);
  const names=fs.readdirSync(root).filter(n=>/^kalpavriksha-1\.9\.30-deploy-\d{8}T\d{6}Z$/.test(n)).sort().reverse();
  const keep=new Set(names.slice(0,2)),dev=fs.statSync(root).dev;
  const uses=[];
  for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){
    try{uses.push(fs.realpathSync('/proc/'+pid+'/cwd'));}catch{}
    try{uses.push(fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replace(/\0/g,' '));}catch{}
  }
  const result={dryRun:!apply,eligibleOrRemoved:[],protected:[]};
  for(const name of names){
    const fp=path.join(root,name);
    try{
      const stat=fs.lstatSync(fp);
      if(!stat.isDirectory()||stat.isSymbolicLink()||stat.dev!==dev||
         fs.realpathSync(fp)!==fp)throw Error('Unsafe directory');
      if(keep.has(name))throw Error('Two newest rollback workspaces protected');
      const t=name.slice(-16);
      const created=Date.UTC(+t.slice(0,4),+t.slice(4,6)-1,+t.slice(6,8),
        +t.slice(9,11),+t.slice(11,13),+t.slice(13,15));
      if(!Number.isFinite(created)||now-Math.max(created,stat.mtimeMs)<7*DAY)
        throw Error('Seven-day grace');
      if(uses.some(u=>u===fp||u.startsWith(fp+'/')||u.includes(fp+' ')))
        throw Error('Referenced by running process');
      for(const rel of ['uploads','data','backups','private-files','backend/uploads',
        'backend/data','backend/backups','backend/private-files','backend/db.json','backend/auth.json'])
        if(fs.existsSync(path.join(fp,rel)))throw Error('Possible unique business data');
      if(apply){
        const validate=dir=>{
          for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
            const p=path.join(dir,ent.name),st=fs.lstatSync(p);
            if(st.dev!==dev)throw Error('Nested filesystem');
            if(ent.isDirectory()&&!ent.isSymbolicLink())validate(p);
          }
        };
        validate(fp);
        fs.rmSync(fp,{recursive:true});
      }
      result.eligibleOrRemoved.push(name);
    }catch(e){result.protected.push({name,reason:e.message});}
  }
  return result;
}
