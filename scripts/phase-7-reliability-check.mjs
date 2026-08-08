import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import { createOperationalJobStore, filesystemUsage, inspectBackupManifests, structuredLog } from '../backend/src/services/operationalReliabilityService.js';

const root=process.cwd();
const serverSource=fs.readFileSync(path.join(root,'backend/src/server.js'),'utf8');
const repoSource=fs.readFileSync(path.join(root,'backend/src/repositories/postgresStateRepository.js'),'utf8');
for(const token of ['/api/health/live','/api/health/ready','/api/system/reliability','/api/system/backups','/api/system/jobs','gracefulShutdown','requestLogMiddleware','STATE_PERSISTENCE_FAILED']) assert.ok(serverSource.includes(token),`Missing reliability integration: ${token}`);
for(const token of ["migration('007.001'",'operational_jobs','operational_events','backup_runs']) assert.ok(repoSource.includes(token),`Missing Phase 7 migration object: ${token}`);
for(const script of ['backup-create.mjs','backup-verify.mjs','backup-status.mjs','restore-drill.mjs']) assert.ok(fs.existsSync(path.join(root,'backend/scripts',script)),`Missing ${script}`);

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'kalp-phase7-'));
const backupRoot=path.join(temp,'backups');fs.mkdirSync(backupRoot,{recursive:true});
const component=path.join(backupRoot,'sample.dump');fs.writeFileSync(component,'verified backup');
const sha256=crypto.createHash('sha256').update(fs.readFileSync(component)).digest('hex');
const manifest={schemaVersion:1,id:'sample',backupType:'DATABASE',status:'VERIFIED',ok:true,createdAt:new Date().toISOString(),verifiedAt:new Date().toISOString(),components:{database:{file:'sample.dump',sizeBytes:fs.statSync(component).size,sha256}},verification:{ok:true,checks:[{component:'database',ok:true}]}};
fs.writeFileSync(path.join(backupRoot,'sample.manifest.json'),JSON.stringify(manifest,null,2));
const failedManifest={schemaVersion:2,id:'failed-later',backupType:'FULL',status:'FAILED',ok:false,createdAt:new Date(Date.now()+1000).toISOString(),completedAt:new Date(Date.now()+1000).toISOString(),components:{},verification:{ok:false,checks:[]},error:'simulated failed later attempt'};
fs.writeFileSync(path.join(backupRoot,'failed-later.manifest.json'),JSON.stringify(failedManifest,null,2));
const backupStatus=inspectBackupManifests(backupRoot,{maxAgeHours:26});assert.equal(backupStatus.ok,true);assert.equal(backupStatus.status,'HEALTHY');assert.equal(backupStatus.latest.id,'failed-later');assert.equal(backupStatus.latestVerified.id,'sample');assert.equal(backupStatus.warning,'LATEST_BACKUP_ATTEMPT_FAILED');
const disk=filesystemUsage(temp);assert.equal(disk.ok,true);assert.ok(disk.totalBytes>0);
const jobs=createOperationalJobStore({dataDir:temp,usePostgres:false});
const failed=await jobs.recordFailure('TEST_JOB',new Error('expected failure'),{safe:true});assert.equal(failed.status,'FAILED');
assert.equal((await jobs.list({status:'FAILED'})).length,1);const retried=await jobs.retry(failed.id,'phase7');assert.equal(retried.status,'PENDING');
const log=structuredLog('info','phase7_verifier',{password:'must redact',ok:true});assert.equal(log.password,'[redacted]');

const dbFile=path.join(temp,'db.json');const authFile=path.join(temp,'auth.json');const fileRoot=path.join(temp,'private-files');const runtimeData=path.join(temp,'runtime-data');
const runtimeJobStore=createOperationalJobStore({dataDir:runtimeData,usePostgres:false});
const safeFailedJob=await runtimeJobStore.recordFailure('BACKUP_STATUS_REFRESH',new Error('temporary verifier failure'),{source:'phase7'},{maxAttempts:3});
const unsafeFailedJob=await runtimeJobStore.recordFailure('STATE_PERSISTENCE',new Error('simulated persistence failure'),{stateVersion:1},{maxAttempts:5});
fs.writeFileSync(dbFile,JSON.stringify({users:[],cases:[],payments:[],teamChat:[],notifications:[],attendanceLogs:[],audit:[],files:[]},null,2));
const port=26000+(process.pid%1000);const base=`http://127.0.0.1:${port}`;let child;let output='';
const start=async()=>{child=spawn(process.execPath,['backend/src/server.js'],{cwd:root,env:{...process.env,NODE_ENV:'development',DATABASE_URL:'',DB_SSL:'false',ALLOW_JSON_FALLBACK:'true',BACKUP_REQUIRED:'true',RELEASE_CERTIFICATE_REQUIRED:'false',RELEASE_VALIDATE_PRODUCTION_ENV:'false',RELEASE_REQUIRE_BACKUP:'false',RELEASE_CERTIFICATE_PATH:path.join(temp,'release-certification.json'),BACKUP_MAX_AGE_HOURS:'26',DISK_WARNING_PERCENT:'98',DISK_CRITICAL_PERCENT:'100',PORT:String(port),KALPA_DATA_DIR:runtimeData,KALPA_DB_FILE:dbFile,KALPA_AUTH_FILE:authFile,KALPA_FILE_STORAGE_ROOT:fileRoot,KALPA_BACKUP_ROOT:backupRoot,BOOTSTRAP_ADMIN_USERNAME:'phase7admin',BOOTSTRAP_ADMIN_PASSWORD:'StrongAdmin123',BOOTSTRAP_ADMIN_NAME:'Phase 7 Admin',API_WRITE_RATE_LIMIT:'1000'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>output+=c.toString());child.stderr.on('data',c=>output+=c.toString());for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error(`Server exited early.\n${output}`);try{if((await fetch(`${base}/api/health/live`)).ok)return;}catch{}await delay(100);}throw new Error(`Server did not start.\n${output}`);};
const stop=async()=>{if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(3000).then(()=>child.exitCode===null&&child.kill('SIGKILL'))]);};
const request=async(pathname,{method='GET',body,session}={})=>{const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(session?.cookie)headers.Cookie=session.cookie;if(session?.csrf&&!['GET','HEAD','OPTIONS'].includes(method))headers['X-CSRF-Token']=session.csrf;const response=await fetch(`${base}${pathname}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const payload=await response.json().catch(()=>({}));const cookie=(response.headers.get('set-cookie')||'').split(';')[0]||session?.cookie||'';return{response,payload,cookie};};
try{
 await start();
 const live=await request('/api/health/live');assert.equal(live.response.status,200);assert.equal(live.payload.status,'ALIVE');
 const ready=await request('/api/health/ready');assert.equal(ready.response.status,200,JSON.stringify(ready.payload));assert.equal(ready.payload.checks.backup,true);
 const disabledManifest=path.join(backupRoot,'sample.manifest.disabled');fs.renameSync(path.join(backupRoot,'sample.manifest.json'),disabledManifest);
 const notReady=await request('/api/health/ready');assert.equal(notReady.response.status,503);assert.equal(notReady.payload.checks.backup,false);
 fs.renameSync(disabledManifest,path.join(backupRoot,'sample.manifest.json'));
 const readyAgain=await request('/api/health/ready');assert.equal(readyAgain.response.status,200);
 const login=await request('/api/auth/login',{method:'POST',body:{username:'phase7admin',password:'StrongAdmin123'}});assert.equal(login.response.ok,true,JSON.stringify(login.payload));const session={cookie:login.cookie,csrf:login.payload.csrfToken};
 const reliability=await request('/api/system/reliability',{session});assert.equal(reliability.response.status,200,JSON.stringify(reliability.payload));assert.equal(reliability.payload.backups.status,'HEALTHY');assert.equal(reliability.payload.disk.storage.ok,true);
 const backups=await request('/api/system/backups',{session});assert.equal(backups.payload.latest.id,'failed-later');assert.equal(backups.payload.latestVerified.id,'sample');assert.equal(backups.payload.warning,'LATEST_BACKUP_ATTEMPT_FAILED');
 const runtimeJobs=await request('/api/system/jobs',{session});assert.equal(runtimeJobs.response.ok,true);assert.equal(runtimeJobs.payload.jobs.some(job=>job.id===safeFailedJob.id),true);
 const safeRetry=await request(`/api/system/jobs/${safeFailedJob.id}/retry`,{method:'POST',session});assert.equal(safeRetry.response.status,200);assert.equal(safeRetry.payload.job.status,'PENDING');
 const unsafeRetry=await request(`/api/system/jobs/${unsafeFailedJob.id}/retry`,{method:'POST',session});assert.equal(unsafeRetry.response.status,409);assert.equal(unsafeRetry.payload.code,'UNSAFE_AUTOMATIC_RETRY');
}finally{await stop();fs.rmSync(temp,{recursive:true,force:true});}
console.log(JSON.stringify({ok:true,phase:7,backupStatus:'HEALTHY',liveness:true,readiness:true,structuredLogs:true,failedJobs:true,gracefulShutdown:true},null,2));
