import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const findings=[];
const requirePattern=(file,pattern,message)=>{
  const source=read(file);
  if(!pattern.test(source)) findings.push({file,message,pattern:String(pattern)});
};
const forbidPattern=(file,pattern,message)=>{
  const source=read(file);
  if(pattern.test(source)) findings.push({file,message,pattern:String(pattern)});
};
const requireOrder=(file,source,before,after,message)=>{
  const first=source.indexOf(before);
  const second=source.indexOf(after,Math.max(0,first));
  if(!(first>=0 && second>first)) findings.push({file,message,before,after});
};

const server=read('backend/src/server.js');
const app=read('frontend/src/App.jsx');
const taskService=read('frontend/src/services/taskService.js');

// A mutation ID is only a replay key when it represents the same operation and payload.
requirePattern('backend/src/server.js',/function taskMutationFingerprint\(/,'Task mutation payload fingerprinting is missing.');
requirePattern('backend/src/server.js',/crypto\.createHash\('sha256'\)/,'Task mutation fingerprints must be deterministic hashes.');
requirePattern('backend/src/server.js',/function assertTaskMutationReplayMatches\(/,'Task mutation replay validator is missing.');
requirePattern('backend/src/server.js',/error\.code='TASK_MUTATION_ID_REUSE'/,'Reusing one mutation ID for a different task change must fail closed.');
requirePattern('backend/src/server.js',/lastTaskMutationFingerprint/,'Committed task writes must retain the mutation fingerprint.');
requirePattern('backend/src/server.js',/lastTaskMutationOperation/,'Committed task writes must retain the mutation operation.');

// Dedicated lifecycle endpoints must require the caller's version rather than silently
// comparing the server task to itself, and they must persist replay metadata atomically.
requirePattern('backend/src/server.js',/assertExpectedTaskVersion\(record,\{\},req\.body \|\| \{\}\)/,'Dedicated lifecycle endpoints must require an explicit client task version once a task is versioned.');
forbidPattern('backend/src/server.js',/assertExpectedTaskVersion\(record,record,req\.body \|\| \{\}\)/,'Dedicated lifecycle version checking must not self-confirm the current server version.');
for(const [route,nextRoute,operation] of [
  ["app.post('/api/cases/:id/assign'","app.post('/api/cases/:id/start'",'assign'],
  ["app.post('/api/cases/:id/start'","app.post('/api/cases/:id/upload-source'",'start'],
  ["app.post('/api/cases/:id/manager-complete'","app.post('/api/cases/:id/revision'",'manager-complete'],
  ["app.post('/api/cases/:id/revision'","app.get('/api/cases/:id/timeline'",'revision'],
  ["app.post('/api/cases/:id/timeline'","app.post('/api/state/projects/:id/payment-status'",'timeline']
]) {
  const start=server.indexOf(route);
  const end=server.indexOf(nextRoute,start);
  const block=start>=0 ? server.slice(start,end>start?end:start+6000) : '';
  if(start<0) findings.push({file:'backend/src/server.js',message:`Lifecycle route missing: ${route}`});
  if(!new RegExp(`prepareDedicatedTaskMutation\\(req,c,'${operation}'\\)`).test(block)) findings.push({file:'backend/src/server.js',message:`${operation} does not prepare a versioned/idempotent task mutation.`});
  if(!/if\s*\(mutation\.replay\)/.test(block)) findings.push({file:'backend/src/server.js',message:`${operation} does not short-circuit exact replay before side effects.`});
  if(!/commitDedicatedTaskMutation\(c,previousCase,mutation\)/.test(block)) findings.push({file:'backend/src/server.js',message:`${operation} does not commit task mutation metadata/version.`});
}

// The main task route must authorize before replay/version disclosure and must persist
// the fingerprint on both creates and updates.
{
  const start=server.indexOf("app.post('/api/state/projects'");
  const end=server.indexOf("app.delete('/api/state/projects",start);
  const block=server.slice(start,end);
  requireOrder('backend/src/server.js',block,'assertProjectUpdateAuthorized(existing, req)','assertTaskMutationReplayMatches(existing,mutationId,mutationFingerprint,mutationOperation)','Existing task writes must authorize before confirming idempotent replay.');
  requireOrder('backend/src/server.js',block,'assertTaskMutationReplayMatches(existing,mutationId,mutationFingerprint,mutationOperation)','assertExpectedTaskVersion(existing, incoming, req.body || {})','Exact replay must be handled before optimistic-version rejection.');
  if((block.match(/lastTaskMutationFingerprint\s*=\s*mutationFingerprint/g)||[]).length<2) findings.push({file:'backend/src/server.js',message:'Both create and update task writes must persist the mutation fingerprint.'});
}

// Deletes must be optimistic-concurrency guarded before a tombstone is committed.
{
  const start=server.indexOf("app.delete('/api/state/projects/:id'");
  const end=server.indexOf("app.post('/api/presence'",start);
  const block=server.slice(start,end);
  requireOrder('backend/src/server.js',block,'assertExpectedTaskVersion(target,target,req.body || {})','rememberDeletedProject','Task delete must reject a stale version before creating any tombstone.');
}

// Browser task saves/deletes must carry stable client-owned mutation metadata.
requirePattern('frontend/src/services/taskService.js',/expectedTaskVersion:expected/,'Task saves must send an expected task version.');
requirePattern('frontend/src/services/taskService.js',/mutationId:stableMutationId/,'Task saves must send a stable client mutation ID.');
requirePattern('frontend/src/services/taskService.js',/body:JSON\.stringify\(\{ expectedTaskVersion, mutationId:String\(mutationId \|\| ''\)\.trim\(\) \}\)/,'Task deletes must send their expected version and stable mutation ID.');
requirePattern('frontend/src/services/taskService.js',/timeoutError\.code = 'TASK_DELETE_TIMEOUT'/,'Delete response-loss/timeouts need a distinct retry-safe classification.');

// Durable delete retry must preserve version + mutation identity and restore the latest
// authoritative task when the version is stale instead of hiding it forever.
requirePattern('frontend/src/App.jsx',/expectedTaskVersion:Number\(record\?\.expectedTaskVersion \|\| 0\)/,'Delete outbox retries must reuse the original expected task version.');
requirePattern('frontend/src/App.jsx',/mutationId:String\(record\?\.mutationId \|\| ''\)/,'Delete outbox retries must reuse the original mutation ID.');
requirePattern('frontend/src/App.jsx',/forgetDeletedProjects\(groupIds\)/,'A permanently rejected queued delete must remove its local tombstones.');
requirePattern('frontend/src/App.jsx',/const expectedTaskVersion=Number\(target\?\.taskVersion \|\| 0\)/,'Interactive delete must capture the version visible to the user.');
requirePattern('frontend/src/App.jsx',/const deleteMutationId=createTaskMutationId\('delete'\)/,'Interactive delete must allocate one stable delete mutation ID.');
requirePattern('frontend/src/App.jsx',/forgetDeletedProjects\(deleteIds\)/,'A stale interactive delete must restore the task instead of leaving it hidden.');
requirePattern('frontend/src/App.jsx',/rollbackProject:options\?\.rollbackProject \? sanitizeProjectForCache\(options\.rollbackProject\)/,'Retryable task updates must preserve the last known server task for offline rollback.');
requirePattern('frontend/src/App.jsx',/rollbackProject:knownExisting \|\| null/,'Transient task updates must enqueue their rollback snapshot.');
requirePattern('frontend/src/App.jsx',/pending-task-version-rollback/,'Queued version conflicts must restore the previous task before refresh.');
requirePattern('frontend/src/App.jsx',/pending-task-permanent-rollback/,'Queued permanent failures must restore the previous task before refresh.');

// In PostgreSQL-authoritative mode a task rejected by version control must never be
// written first to the legacy cloud mirror. Only server-confirmed objects may mirror.
{
  const start=app.indexOf('const handleUpdateProject');
  const end=app.indexOf('const handlePaymentStatusChange',start);
  const block=app.slice(start,end);
  if(!/if \(!USE_BACKEND_STATE && firebaseUser && !isLocalMock\)/.test(block)) findings.push({file:'frontend/src/App.jsx',message:'Direct cloud task writes must be restricted to non-backend mode.'});
  requireOrder('frontend/src/App.jsx',block,"applyProjectSnapshot([confirmed],{source:'task-update-confirmed',replaceIds})",'stripLargeLocalFilesForCloud(confirmed)','Backend-authoritative cloud mirroring must use the confirmed server task after local confirmation is applied.');
}
{
  const start=app.indexOf('const handleDeleteTask');
  const end=app.indexOf('const handleSendMessage',start);
  const block=app.slice(start,end);
  requireOrder('frontend/src/App.jsx',block,'const data = await deleteTaskApi','Confirmed task cloud mirror delete failed','Backend-mode cloud deletion must happen only after authoritative delete confirmation.');
  if(!/if \(!USE_BACKEND_STATE && firebaseUser && !isLocalMock\) await deleteDoc/.test(block)) findings.push({file:'frontend/src/App.jsx',message:'Unconfirmed direct cloud deletion must be restricted to non-backend mode.'});
}

// New task creation has its own direct mirror path; it too must wait for the
// authoritative server in backend mode, including after a transient save failure.
requirePattern('frontend/src/App.jsx',/let projectConfirmedByBackend = !USE_BACKEND_STATE/,'New task creation must track authoritative confirmation state.');
requirePattern('frontend/src/App.jsx',/if \(firebaseUser && !isLocalMock && \(!USE_BACKEND_STATE \|\| projectConfirmedByBackend\)\)/,'New tasks must not be mirrored to the cloud before backend confirmation.');
requirePattern('frontend/src/App.jsx',/Pre-upload confirmed task cloud mirror update failed/,'A task first confirmed by pre-upload recovery must mirror only the confirmed server record.');
requirePattern('frontend/src/App.jsx',/Pending confirmed task cloud mirror update failed/,'A task first confirmed by durable retry must mirror only the confirmed server record.');

// UI-level double-submit guard for task creation must remain in place.
requirePattern('frontend/src/App.jsx',/if \(isSubmittingLead\) return;/,'Task creation handler must ignore double submits while one create is active.');
requirePattern('frontend/src/App.jsx',/<Button type="submit" loading=\{isSubmittingLead\} disabled=\{isSubmittingLead\}/,'Create-task submit control must remain disabled while the mutation is active.');

if(findings.length){
  console.error('Phase 13 task lifecycle/idempotency verification failed.');
  for(const finding of findings) console.error(`- ${finding.file}: ${finding.message}${finding.pattern?` (${finding.pattern})`:''}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok:true,
  check:'phase-13-task-lifecycle-idempotency-closure',
  lifecycleRoutesGuarded:5,
  mutationReplayPolicy:'same-id-requires-same-operation-and-payload',
  deletePolicy:'versioned-durable-retry-with-stale-rollback',
  cloudMirrorPolicy:'authoritative-confirmation-before-backend-mode-mirror',
  doubleSubmitGuard:true
},null,2));
