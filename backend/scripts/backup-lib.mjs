import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import pg from 'pg';

export const isoStamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export const ensureDir = dir => fs.mkdirSync(path.resolve(dir), { recursive: true });
export const sha256File = filePath => {
  const hash=crypto.createHash('sha256');
  const fd=fs.openSync(filePath,'r');
  const buffer=Buffer.allocUnsafe(1024*1024);
  try { let bytes=0; while((bytes=fs.readSync(fd,buffer,0,buffer.length,null))>0) hash.update(buffer.subarray(0,bytes)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
};
export const fileMeta = filePath => ({ file:path.basename(filePath), sizeBytes:fs.statSync(filePath).size, sha256:sha256File(filePath) });
export const commandExists = command => spawnSync(command,['--version'],{stdio:'ignore'}).status===0;
export function run(command,args,{env=process.env,stdio='pipe'}={}) {
  const result=spawnSync(command,args,{env,encoding:'utf8',stdio});
  if(result.status!==0){const error=new Error(`${command} failed (${result.status}): ${String(result.stderr || result.stdout || '').trim()}`);error.code='BACKUP_COMMAND_FAILED';error.command=command;throw error;}
  return result;
}
export function atomicJson(filePath,payload){
  ensureDir(path.dirname(filePath));
  const temp=`${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(payload,null,2));
  fs.renameSync(temp,filePath);
}
export function listManifests(root){
  ensureDir(root);
  return fs.readdirSync(root).filter(name=>name.endsWith('.manifest.json')).map(name=>path.join(root,name)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
}
export function latestManifest(root){return listManifests(root)[0] || '';}
export function verifyManifest(manifestPath,{verifyContents=true}={}){
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const root=path.dirname(manifestPath);
  const checks=[];
  for(const key of ['database','files']){
    const component=manifest.components?.[key];
    if(!component?.file)continue;
    const fp=path.join(root,component.file);
    if(!fs.existsSync(fp)){checks.push({component:key,ok:false,error:'Missing file'});continue;}
    const sizeBytes=fs.statSync(fp).size;
    const sha256=sha256File(fp);
    const ok=sizeBytes===Number(component.sizeBytes)&&sha256===component.sha256;
    const check={component:key,ok,sizeBytes,sha256};
    if(ok&&verifyContents){
      try{
        if(key==='database')run(process.env.PG_RESTORE_BIN || 'pg_restore',['--list',fp]);
        if(key==='files')run(process.env.TAR_BIN || 'tar',['-tzf',fp]);
        check.contentReadable=true;
      }catch(error){check.ok=false;check.contentReadable=false;check.error=error.message;}
    }
    checks.push(check);
  }
  const ok=checks.length>0&&checks.every(item=>item.ok);
  return {ok,checks,manifest};
}
export async function recordBackupRun(databaseUrl,record={}){
  if(!/^postgres(ql)?:\/\//i.test(String(databaseUrl||'')))return;
  const {Pool}=pg;const pool=new Pool({connectionString:databaseUrl,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:undefined,connectionTimeoutMillis:Number(process.env.DB_CONNECT_TIMEOUT_MS||10000)});
  try{
    await pool.query(
      `INSERT INTO backup_runs(id,backup_type,status,manifest_path,database_file,files_archive,database_sha256,files_sha256,size_bytes,details,started_at,completed_at,verified_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,now())
       ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,manifest_path=EXCLUDED.manifest_path,database_file=EXCLUDED.database_file,files_archive=EXCLUDED.files_archive,database_sha256=EXCLUDED.database_sha256,files_sha256=EXCLUDED.files_sha256,size_bytes=EXCLUDED.size_bytes,details=EXCLUDED.details,completed_at=EXCLUDED.completed_at,verified_at=EXCLUDED.verified_at,updated_at=now()`,
      [record.id,record.backupType||'FULL',record.status||'CREATED',record.manifestPath||'',record.databaseFile||'',record.filesArchive||'',record.databaseSha256||'',record.filesSha256||'',Number(record.sizeBytes||0),JSON.stringify(record.details||{}),record.startedAt||new Date().toISOString(),record.completedAt||null,record.verifiedAt||null]
    );
  }catch(error){if(!/backup_runs/i.test(error.message||''))throw error;}
  finally{await pool.end().catch(()=>{});}
}
export function pruneBackups(root,{retentionDays=30,retentionCount=30}={}){
  const manifests=listManifests(root);const keep=new Set(manifests.slice(0,Math.max(1,retentionCount)));
  const cutoff=Date.now()-Math.max(1,retentionDays)*86400000;const removed=[];
  for(const manifestPath of manifests){
    if(keep.has(manifestPath)||fs.statSync(manifestPath).mtimeMs>=cutoff)continue;
    try{
      const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
      for(const component of Object.values(manifest.components||{})){if(component?.file){const fp=path.join(root,component.file);if(fs.existsSync(fp))fs.rmSync(fp,{force:true});}}
      fs.rmSync(manifestPath,{force:true});removed.push(path.basename(manifestPath));
    }catch{}
  }
  return removed;
}
