import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';
import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import { createFileStorage, buildFileReconciliationReport, FileValidationError } from '../backend/src/services/fileStorageService.js';

const root = process.cwd();
const serverSource = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(root, 'backend/src/services/fileStorageService.js'), 'utf8');
const repositorySource = fs.readFileSync(path.join(root, 'backend/src/repositories/postgresStateRepository.js'), 'utf8');
const check = (condition, message) => { if (!condition) throw new Error(message); };

for (const token of ['FILE_SIGNATURE_MISMATCH','OFFICE_CONTAINER_INVALID','MALWARE_DETECTED','sha256','quarantine','softDelete','acquireLease','hasActiveLease','local-private','buildFileReconciliationReport','pruneTrash']) {
  check(storageSource.includes(token), `File-storage service is missing ${token}.`);
}
for (const token of ['KALPA_FILE_STORAGE_ROOT','FILE_STORAGE_PERSISTENT','prepareSecureUploads','RECONCILE FILE STORAGE','COLLECT FILE STORAGE GARBAGE','FILE_STORAGE_GC_GRACE_MS','FILE_DELETED','FILE_RETENTION_DAYS','FILE_RETENTION_EXPIRED','automatic_file_retention']) {
  check(serverSource.includes(token), `Server file hardening is missing ${token}.`);
}
check(repositorySource.includes("migration('006.001'"), 'Phase 6 migration is missing.');
check(repositorySource.includes('file_storage_events') && repositorySource.includes('file_reconciliation_runs'), 'File audit/reconciliation tables are missing.');
check(!/express\.static\([^)]*(?:uploads|UPLOAD)/i.test(serverSource), 'An upload directory is still publicly exposed through express.static.');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kalp-file-phase6-'));
const storageRoot = path.join(temp, 'private');
const legacyRoot = path.join(temp, 'legacy');
fs.mkdirSync(legacyRoot, { recursive:true });
const storage = createFileStorage({ root:storageRoot, legacyRoots:[legacyRoot] });
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const makeTempUpload = (name, bytes, mime='application/octet-stream') => {
  const filePath=path.join(storage.tempRoot, `${Date.now()}-${Math.random().toString(16).slice(2)}.upload`);
  fs.writeFileSync(filePath, bytes);
  return { path:filePath, originalname:name, mimetype:mime, size:bytes.length };
};

const first = await storage.validateAndStore(makeTempUpload('../../safe-report.pdf', pdfBytes, 'text/html'), {purpose:'SOURCE'});
assert.match(first.storageKey, /^objects\/[a-f0-9]{2}\/[a-f0-9]{64}\.pdf$/);
assert.equal(first.detectedMime, 'application/pdf');
assert.equal(first.securityStatus, 'VALIDATED');
assert.equal(first.antivirusStatus, 'NOT_CONFIGURED');
assert.equal(first.originalName, 'safe-report.pdf');
assert.ok(fs.existsSync(storage.resolve({storageKey:first.storageKey}).fp));
const duplicate = await storage.validateAndStore(makeTempUpload('copy.pdf', pdfBytes, 'application/pdf'), {purpose:'FINAL'});
assert.equal(duplicate.storageKey, first.storageKey);
assert.equal(duplicate.deduplicated, true);

let mismatchRejected=false;
try { await storage.validateAndStore(makeTempUpload('fake.pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf')); }
catch (error) { mismatchRejected=error instanceof FileValidationError && error.code==='FILE_SIGNATURE_MISMATCH'; }
assert.equal(mismatchRejected,true,'A disguised HTML file was not rejected.');
let executableRejected=false;
try { await storage.validateAndStore(makeTempUpload('malware.exe', Buffer.from('MZfake'), 'application/octet-stream')); }
catch (error) { executableRejected=error instanceof FileValidationError && error.code==='FILE_TYPE_NOT_ALLOWED'; }
assert.equal(executableRejected,true,'Executable upload was not rejected.');
let fakeOfficeRejected=false;
try { await storage.validateAndStore(makeTempUpload('fake.docx', Buffer.from([0x50,0x4b,0x03,0x04,0x66,0x61,0x6b,0x65]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')); }
catch (error) { fakeOfficeRejected=error instanceof FileValidationError && error.code==='OFFICE_CONTAINER_INVALID'; }
assert.equal(fakeOfficeRejected,true,'A renamed ZIP was accepted as an Office document.');
assert.ok(fs.readdirSync(storage.quarantineRoot,{recursive:true}).some(name=>String(name).endsWith('.json')),'Rejected files were not quarantined with metadata.');

const missingState={files:[{id:'ok',name:'safe-report.pdf',storageKey:first.storageKey,storedName:path.basename(first.storageKey)},{id:'missing',name:'gone.pdf',storageKey:'objects/ff/missing.pdf'}]};
const report=buildFileReconciliationReport(missingState,storage,{docs:missingState.files});
assert.equal(report.counts.available,1);
assert.equal(report.counts.missing,1);

// Runtime integration with authentication, legacy import and soft-delete.
const dbFile=path.join(temp,'db.json');
const authFile=path.join(temp,'auth.json');
const liveStorage=path.join(temp,'live-private');
const legacyUpload=path.join(temp,'live-legacy');
fs.mkdirSync(legacyUpload,{recursive:true});
const legacyName='1711111111111-old-report.pdf';
fs.writeFileSync(path.join(legacyUpload,legacyName),pdfBytes);
const seedCase={id:'FILE-TASK-1',caseId:'FILE-TASK-1',customerName:'File Test',assignedTo:'Phase 6 Admin',assigneeName:'Phase 6 Admin',status:'ASSIGNED',documents:[{id:'legacy-file-1',caseId:'FILE-TASK-1',name:'old-report.pdf',storedName:legacyName,mime:'application/pdf',purpose:'SOURCE',uploadedBy:'Phase 6 Admin'}]};
fs.writeFileSync(dbFile,JSON.stringify({users:[],cases:[seedCase],projects:[seedCase],payments:[],teamChat:[],notifications:[],attendanceLogs:[],audit:[],files:[{id:'legacy-file-1',caseId:'FILE-TASK-1',name:'old-report.pdf',storedName:legacyName,mime:'application/pdf',purpose:'SOURCE',uploadedBy:'Phase 6 Admin'}]},null,2));
const port=24000+(process.pid%1000);
const base=`http://127.0.0.1:${port}`;
let child; let output='';
const start=async()=>{
  child=spawn(process.execPath,['backend/src/server.js'],{cwd:root,env:{...process.env,NODE_ENV:'development',DATABASE_URL:'',DB_SSL:'false',ALLOW_JSON_FALLBACK:'true',PORT:String(port),KALPA_DB_FILE:dbFile,KALPA_AUTH_FILE:authFile,KALPA_LEGACY_UPLOAD_DIR:legacyUpload,KALPA_FILE_STORAGE_ROOT:liveStorage,FILE_STORAGE_GC_GRACE_MS:'0',BOOTSTRAP_ADMIN_USERNAME:'phase6admin',BOOTSTRAP_ADMIN_PASSWORD:'StrongAdmin123',BOOTSTRAP_ADMIN_NAME:'Phase 6 Admin',API_WRITE_RATE_LIMIT:'1000'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{output+=chunk.toString();}); child.stderr.on('data',chunk=>{output+=chunk.toString();});
  for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error(`Server exited early.\n${output}`);try{if((await fetch(`${base}/api/health/live`)).ok)return;}catch{}await delay(100);}throw new Error(`Server did not start.\n${output}`);
};
const stop=async()=>{if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(2000).then(()=>child.exitCode===null&&child.kill('SIGKILL'))]);};
const request=async(pathname,{method='GET',body,session,headers={}}={})=>{
  const h={...headers}; if(body!==undefined)h['Content-Type']='application/json'; if(session?.cookie)h.Cookie=session.cookie; if(session?.csrf&&!['GET','HEAD','OPTIONS'].includes(method))h['X-CSRF-Token']=session.csrf;
  const response=await fetch(`${base}${pathname}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}); const ct=response.headers.get('content-type')||''; const payload=ct.includes('json')?await response.json().catch(()=>({})):await response.text().catch(()=>''); const set=response.headers.get('set-cookie')||''; return{response,payload,cookie:set?set.split(';')[0]:session?.cookie||''};
};
const multipart=async(pathname,form,session)=>{const h={};if(session?.cookie)h.Cookie=session.cookie;if(session?.csrf)h['X-CSRF-Token']=session.csrf;const response=await fetch(`${base}${pathname}`,{method:'POST',headers:h,body:form});return{response,payload:await response.json().catch(()=>({}))};};
try{
  await start();
  const login=await request('/api/auth/login',{method:'POST',body:{username:'phase6admin',password:'StrongAdmin123'}});
  assert.equal(login.response.ok,true,JSON.stringify(login.payload));
  const session={cookie:login.cookie,csrf:login.payload.csrfToken};
  const health=await request('/api/system/files/storage-health',{session});
  assert.equal(health.response.ok,true);
  assert.equal(health.payload.writable,true);
  const before=await request('/api/system/files/reconciliation',{session});
  assert.equal(before.response.ok,true);
  assert.equal(before.payload.legacyAvailable>=1,true,'Legacy file was not detected.');
  const repaired=await request('/api/system/files/reconciliation',{method:'POST',session,body:{confirm:'RECONCILE FILE STORAGE'}});
  assert.equal(repaired.response.ok,true,JSON.stringify(repaired.payload));
  assert.equal(repaired.payload.imported>=1,true,'Legacy file was not imported into private storage.');
  const legacyDownload=await request('/api/files/legacy-file-1/download',{session});
  assert.equal(legacyDownload.response.ok,true,'Imported legacy file could not be downloaded.');

  const runtimePdfBytes=Buffer.from('%PDF-1.4\n% runtime unique\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  const form=new FormData(); form.append('file',new Blob([runtimePdfBytes],{type:'text/html'}),'runtime-report.pdf'); form.append('projectId','FILE-TASK-1'); form.append('type','source');
  const uploaded=await multipart('/api/files/upload',form,session);
  assert.equal(uploaded.response.status,201,JSON.stringify(uploaded.payload));
  assert.match(uploaded.payload.file.storageKey,/^objects\//);
  assert.equal(uploaded.payload.file.sha256.length,64);
  assert.equal(uploaded.payload.file.mime,'application/pdf');
  assert.equal(uploaded.payload.file.url,`/api/files/${uploaded.payload.file.id}/download`);
  const anonymous=await fetch(`${base}/api/files/${uploaded.payload.file.id}/download`);
  assert.equal(anonymous.status,401,'Anonymous file download was allowed.');
  const download=await request(`/api/files/${uploaded.payload.file.id}/download`,{session});
  assert.equal(download.response.ok,true,'Authorized file download failed.');

  const fakeForm=new FormData(); fakeForm.append('file',new Blob(['<html>bad</html>'],{type:'application/pdf'}),'fake.pdf'); fakeForm.append('projectId','FILE-TASK-1'); fakeForm.append('type','source');
  const fake=await multipart('/api/files/upload',fakeForm,session);
  assert.equal(fake.response.status,400);
  assert.equal(fake.payload.code,'FILE_SIGNATURE_MISMATCH');

  const duplicateForm=new FormData(); duplicateForm.append('file',new Blob([runtimePdfBytes],{type:'application/pdf'}),'runtime-report-copy.pdf'); duplicateForm.append('projectId','FILE-TASK-1'); duplicateForm.append('type','source');
  const duplicateRuntime=await multipart('/api/files/upload',duplicateForm,session);
  assert.equal(duplicateRuntime.response.status,201,JSON.stringify(duplicateRuntime.payload));
  assert.equal(duplicateRuntime.payload.file.storageKey,uploaded.payload.file.storageKey,'Runtime deduplication did not reuse the content-addressed object.');

  const firstDeletion=await request(`/api/files/${uploaded.payload.file.id}`,{method:'DELETE',session,body:{reason:'Phase 6 shared-object verification'}});
  assert.equal(firstDeletion.response.ok,true,JSON.stringify(firstDeletion.payload));
  assert.equal(firstDeletion.payload.storageStatus,'DELETED');
  assert.equal(firstDeletion.payload.physicalAction,'retained-shared-object');
  const firstGc=await request('/api/system/files/garbage-collect',{method:'POST',session,body:{confirm:'COLLECT FILE STORAGE GARBAGE'}});
  assert.equal(firstGc.response.ok,true,JSON.stringify(firstGc.payload));
  assert.equal(firstGc.payload.movedToTrash,0,'Garbage collection moved an object that still had an active deduplicated reference.');
  const sharedDownload=await request(`/api/files/${duplicateRuntime.payload.file.id}/download`,{session});
  assert.equal(sharedDownload.response.ok,true,'Deleting one deduplicated record broke the remaining file.');

  const secondDeletion=await request(`/api/files/${duplicateRuntime.payload.file.id}`,{method:'DELETE',session,body:{reason:'Phase 6 final-reference verification'}});
  assert.equal(secondDeletion.response.ok,true,JSON.stringify(secondDeletion.payload));
  assert.equal(secondDeletion.payload.storageStatus,'DELETED');
  assert.equal(secondDeletion.payload.physicalAction,'retained-for-safe-gc');
  const afterDelete=await request(`/api/files/${duplicateRuntime.payload.file.id}/download`,{session});
  assert.equal(afterDelete.response.status,410,'Deleted file remained downloadable.');
  const finalGc=await request('/api/system/files/garbage-collect',{method:'POST',session,body:{confirm:'COLLECT FILE STORAGE GARBAGE'}});
  assert.equal(finalGc.response.ok,true,JSON.stringify(finalGc.payload));
  assert.equal(finalGc.payload.movedToTrash>=1,true,'Unreferenced object was not moved by the grace-period garbage collector.');
  const trashFiles=fs.readdirSync(path.join(liveStorage,'trash'),{recursive:true});
  assert.equal(trashFiles.some(name=>String(name).endsWith('.pdf')),true,'Garbage-collected object was not placed in recoverable trash.');

  console.log(JSON.stringify({ok:true,phase:6,signatureValidation:true,contentAddressing:true,deduplication:true,legacyImported:repaired.payload.imported,softDelete:true,uploadLeases:true,gracePeriodGarbageCollection:true,reconciliation:repaired.payload.after},null,2));
}finally{await stop();fs.rmSync(temp,{recursive:true,force:true});}
