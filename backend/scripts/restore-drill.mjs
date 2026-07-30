import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { atomicJson, isoStamp, latestManifest, run, verifyManifest } from './backup-lib.mjs';
const productionUrl=String(process.env.DATABASE_URL||'').trim();
const drillUrl=String(process.env.RESTORE_DRILL_DATABASE_URL||'').trim();
if(!/^postgres(ql)?:\/\//i.test(drillUrl))throw new Error('RESTORE_DRILL_DATABASE_URL is required.');
if(drillUrl===productionUrl)throw new Error('Restore drill refused: RESTORE_DRILL_DATABASE_URL matches DATABASE_URL.');
const dbName=decodeURIComponent(new URL(drillUrl).pathname.replace(/^\//,''));
if(!/(restore|drill|test|staging)/i.test(dbName)&&String(process.env.ALLOW_UNSAFE_DRILL_DATABASE_NAME||'').toLowerCase()!=='true')throw new Error('Restore drill database name must include restore, drill, test, or staging.');
const backupRoot=path.resolve(process.env.KALPA_BACKUP_ROOT||path.join(process.cwd(),'backups'));
const manifestPath=path.resolve(process.argv[2]||latestManifest(backupRoot)||'');
if(!manifestPath||!fs.existsSync(manifestPath))throw new Error('No backup manifest was found.');
const verification=verifyManifest(manifestPath,{verifyContents:true});
if(!verification.ok)throw new Error('Backup verification failed; restore drill was not started.');
const manifest=verification.manifest;const report={schemaVersion:1,id:`drill-${isoStamp()}`,manifestId:manifest.id,manifestPath,startedAt:new Date().toISOString(),status:'RUNNING',database:{},files:{}};
const reportPath=path.join(backupRoot,`${report.id}.restore-drill.json`);
try{
  const databaseFile=manifest.components?.database?.file?path.join(backupRoot,manifest.components.database.file):'';
  if(databaseFile){
    run(process.env.PG_RESTORE_BIN||'pg_restore',['--clean','--if-exists','--no-owner','--no-acl','--dbname',drillUrl,databaseFile]);
    const query=run(process.env.PSQL_BIN||'psql',[drillUrl,'--tuples-only','--no-align','--command',"SELECT coalesce((SELECT state_version::text FROM app_state_metadata WHERE key='main'),'missing') || '|' || (SELECT count(*)::text FROM schema_migrations) || '|' || (SELECT count(*)::text FROM ops_cases);"]);
    const [stateVersion,migrationCount,caseCount]=String(query.stdout||'').trim().split('|');
    report.database={ok:true,stateVersion:Number(stateVersion),migrationCount:Number(migrationCount),caseCount:Number(caseCount)};
  }else report.database={ok:true,skipped:true};
  const filesArchive=manifest.components?.files?.file?path.join(backupRoot,manifest.components.files.file):'';
  if(filesArchive){
    const restoreRoot=path.resolve(process.env.KALPA_RESTORE_DRILL_ROOT||path.join(backupRoot,report.id));
    if(fs.existsSync(restoreRoot)&&fs.readdirSync(restoreRoot).length)throw new Error(`Restore drill directory is not empty: ${restoreRoot}`);
    fs.mkdirSync(restoreRoot,{recursive:true});run(process.env.TAR_BIN||'tar',['-xzf',filesArchive,'-C',restoreRoot]);
    const files=fs.readdirSync(restoreRoot,{recursive:true}).filter(name=>fs.statSync(path.join(restoreRoot,name)).isFile());
    report.files={ok:true,restoreRoot,fileCount:files.length};
  }else report.files={ok:true,skipped:true};
  report.status='DRILL_PASSED';report.ok=true;report.completedAt=new Date().toISOString();atomicJson(reportPath,report);console.log(JSON.stringify(report,null,2));
}catch(error){report.status='DRILL_FAILED';report.ok=false;report.error=error.message||String(error);report.completedAt=new Date().toISOString();atomicJson(reportPath,report);console.error(JSON.stringify(report,null,2));process.exitCode=2;}
