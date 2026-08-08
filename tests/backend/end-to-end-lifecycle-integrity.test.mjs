import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../../backend/src/server.js',import.meta.url),'utf8');

test('task route uses immutable IDs, version checks, and explicit idempotent mutation confirmation',()=>{
  assert.match(server,/next\.id = existing\.id/);
  assert.match(server,/assertExpectedTaskVersion\(existing, incoming, req\.body \|\| \{\}\)/);
  assert.match(server,/existing\.lastTaskMutationId/);
  assert.match(server,/idempotent:true/);
  assert.match(server,/safeIncoming\.taskVersion = nextTaskVersion\(existing\)/);
  const mutationStart=server.indexOf('function taskMutationId');
  const mutationEnd=server.indexOf('function completedTaskDocuments',mutationStart);
  const mutationBlock=server.slice(mutationStart,mutationEnd);
  assert.match(mutationBlock,/body\.mutationId/);
  assert.match(mutationBlock,/incoming\.clientMutationId/);
  assert.doesNotMatch(mutationBlock,/lastTaskMutationId/);
});

test('lifecycle cannot enter review or completion without a stored final deliverable',()=>{
  assert.match(server,/COMPLETED_FILE_REQUIRED/);
  assert.match(server,/TASK_COMPLETION_FORBIDDEN/);
  assert.match(server,/assertTaskLifecycleTransition\(existing, safeIncoming, actor\)/);
  assert.match(server,/assertTaskLifecycleTransition\(c,\{\.\.\.c,status:'COMPLETED'\},actor\)/);
});

test('all operational upload purposes are accepted and task files are linked atomically',()=>{
    for (const marker of ["source:'SOURCE'","working:'WORKING'","completed:'FINAL'","revision:'REVISION'","discussion:'DISCUSSION'","'payment-receipt':'PAYMENT_RECEIPT'","chat:'CHAT'"]) assert.ok(server.includes(marker), `missing upload purpose ${marker}`);
  assert.match(server,/attachStoredFileToCase/);
  assert.match(server,/collections\.push\('cases'\)/);
  assert.match(server,/res\.status\(201\)\.json\(\{ok:true,file,project:visibleCase,case:visibleCase,requestedProjectId:projectId,resolvedProjectId,persistence\}\)/);
});

test('long uploads reauthorise a fresh task immediately before persistence',()=>{
  const start=server.indexOf("app.post('/api/files/upload'");
  const end=server.indexOf("app.get('/api/files/:id'",start);
  const block=server.slice(start,end);
  assert.ok(block.indexOf('prepareSecureUploads') < block.indexOf('taskDb(resolvedProjectId'));
  assert.match(block,/const initialState=readDb\(\);\s*authorizeUpload\(initialState\)/);
  assert.match(block,/const uploadSnapshot=taskDb\(resolvedProjectId,\{files:true\}\);\s*const d=uploadSnapshot\.snapshot;\s*const caseRecord=authorizeUpload\(d\)/);
});

test('hot task, upload, and delete paths avoid cloning unrelated workspace collections',()=>{
  assert.match(server,/function taskDb\(/);
  assert.match(server,/function fileDeleteDb\(/);
  assert.match(server,/takeSnapshotOwnership:true/);
  const projectStart=server.indexOf("app.post('/api/state/projects'");
  const projectEnd=server.indexOf("app.delete('/api/state/projects",projectStart);
  assert.match(server.slice(projectStart,projectEnd),/taskDb\(projectId,\{audit:true,notifications:true\}\)/);
});

test('file deletion returns the committed affected task instead of requiring a second browser write',()=>{
  const start=server.indexOf("app.delete('/api/files/:id'");
  const end=server.indexOf("app.get('/api/system/files/storage-health'",start);
  const block=server.slice(start,end);
  assert.match(block,/visibleCases/);
  assert.match(block,/case:visibleCases\[0\] \|\| null/);
  assert.match(block,/takeSnapshotOwnership:true/);
});

test('partial admin and manager edits preserve omitted task fields and do not supersede their own immutable id',()=>{
  const start=server.indexOf('function authorizedProjectUpdate');
  const end=server.indexOf('function sanitizeCaseForActor',start);
  const block=server.slice(start,end);
  assert.match(block,/preserveFinanceFields\(existing, \{ \.\.\.existing, \.\.\.\(incoming \|\| \{\}\) \}\)/);
  assert.match(block,/previousDisplayId !== String\(existing\.id \|\| ''\)/);
  assert.match(block,/next\.id = existing\.id/);
});

test('dedicated task lifecycle routes use selective snapshots and transfer ownership without cloning the workspace',()=>{
  assert.match(server,/function requestTaskDb\(req = \{\}, options = \{\}\)/);
  assert.match(server,/requireCaseAction\('update',\{notifications:true,audit:true\}\)/);
  assert.match(server,/requireCaseAction\('upload-final',\{files:true,notifications:true,audit:true\}\)/);
  assert.match(server,/const transientState = readDb\(\)/);
  for (const reason of ['case_assign','case_start','case_source_upload','case_manager_complete','case_revision_open','case_timeline_add']) {
    const index=server.indexOf(`reason:'${reason}'`);
    assert.ok(index > 0, `missing ${reason}`);
    assert.match(server.slice(index,index+220),/takeSnapshotOwnership:true/);
  }
  assert.match(server,/reason:isRevision\?'case_revision_final_upload':'case_final_upload',takeSnapshotOwnership:true/);
});

test('task display-id collisions are rejected before renamed records can merge',()=>{
  assert.match(server,/function assertCaseDisplayIdentityAvailable/);
  assert.match(server,/error\.code='TASK_DISPLAY_ID_CONFLICT'/);
  const routeStart=server.indexOf("app.post('/api/state/projects'");
  const routeEnd=server.indexOf("app.delete('/api/state/projects",routeStart);
  const route=server.slice(routeStart,routeEnd);
  assert.ok(route.indexOf('assertCaseDisplayIdentityAvailable') < route.indexOf('mergeCasesPreservingFreshest'));
});

test('atomic file upload validates lifecycle against the pre-upload task, not the mutated object',()=>{
  const start=server.indexOf("app.post('/api/files/upload'");
  const end=server.indexOf("app.get('/api/files/:id'",start);
  const block=server.slice(start,end);
  assert.match(block,/const previousCase=structuredClone\(caseRecord\)/);
  assert.match(block,/assertTaskLifecycleTransition\(previousCase,updatedCase,actor\)/);
  assert.doesNotMatch(block,/assertTaskLifecycleTransition\(caseRecord,updatedCase,actor\)/);
});

test('finance snapshots clone only payment rows linked to the selected task',()=>{
  const start=server.indexOf('function financeDb');
  const end=server.indexOf('function taskDb',start);
  const block=server.slice(start,end);
  assert.match(block,/const payments=\(memoryState\.payments \|\| \[\]\)\.slice\(\)/);
  assert.match(block,/if \(matchesLinkedId \|\| matchesTask\) payments\[index\]=payment \? \{\.\.\.payment\} : payment/);
  assert.doesNotMatch(block,/\.map\(payment => payment \? \{ \.\.\.payment \}/);
});

test('deleting through any current or historical task alias removes the immutable task and tombstones every alias',()=>{
  const start=server.indexOf("app.delete('/api/state/projects/:id'");
  const end=server.indexOf("app.post('/api/presence'",start);
  const block=server.slice(start,end);
  assert.match(block,/const target=req\.caseRecord/);
  assert.match(block,/const targetIds=new Set\(\[\.\.\.getCaseIdentitySet\(target\),requestedId\]/);
  assert.match(block,/for \(const identity of targetIds\) rememberDeletedProject\(d,identity\)/);
  assert.match(block,/String\(record\?\.id \|\| ''\)!==String\(target\.id \|\| ''\)/);
});

test('designers cannot restart or upload over completed work until a manager reopens revision',()=>{
  assert.match(server,/error\.code = 'TASK_REOPEN_FORBIDDEN'/);
  const startRoute=server.slice(server.indexOf("app.post('/api/cases/:id/start'"),server.indexOf("app.post('/api/cases/:id/upload-source'"));
  assert.match(startRoute,/const previousCase=structuredClone\(c\)/);
  assert.match(startRoute,/assertTaskLifecycleTransition\(previousCase,c,actor\)/);
  const finalRoute=server.slice(server.indexOf("app.post('/api/cases/:id/upload-final'"),server.indexOf("app.post('/api/cases/:id/manager-complete'"));
  assert.match(finalRoute,/isRevision=requestedRevision \|\| statusKey\(c\.status\)==='REOPENEDFORREVISION'/);
  assert.match(finalRoute,/assertTaskLifecycleTransition\(previousCase,c,actor\)/);
});

test('finance durability verifier supplies the required optimistic task version',()=>{
  const verifier=fs.readFileSync(new URL('../../scripts/phase-2-finance-durability-check.mjs',import.meta.url),'utf8');
  assert.match(verifier,/const createdTaskVersion = Number\(created\.payload\?\.project\?\.taskVersion \|\| 0\)/);
  assert.match(verifier,/expectedTaskVersion: createdTaskVersion/);
  assert.match(verifier,/Operational edit was rejected during stale-finance protection verification/);
});

test('authorization verifier supplies finance context, task versions, and a lifecycle-safe assignment status',()=>{
  const verifier=fs.readFileSync(new URL('../../scripts/phase-4-authorization-check.mjs',import.meta.url),'utf8');
  assert.match(verifier,/const taskOne = await makeTask\('AUTHZ-TASK-1'/);
  assert.match(verifier,/expectedAmount:9000, amountIn:5000/);
  assert.match(verifier,/expectedTaskVersion:taskOne\.taskVersion/);
  assert.match(verifier,/expectedTaskVersion:ownUpdate\.payload\.project\.taskVersion/);
  assert.match(verifier,/expectedTaskVersion:managerCreated\.payload\.project\.taskVersion/);
  assert.match(verifier,/spoofedIdempotentReplay/);
  assert.match(verifier,/managerEchoEdit/);
  assert.match(verifier,/lastTaskMutationId !== managerRecentEdit\.payload\.project\.lastTaskMutationId/);
  assert.match(verifier,/status:'Assigned'/);
  assert.match(verifier,/paymentTrackingStatus === 'Pending'/);
  assert.match(verifier,/Deliberately omit expectedTaskVersion here/);
  assert.match(verifier,/spoofedOtherUpdate\.payload\?\.code === 'TASK_UPDATE_FORBIDDEN'/);
  assert.match(verifier,/spoofedBroadStateUpdate\.payload\?\.code === 'TASK_UPDATE_FORBIDDEN'/);
});



test('task authorization precedes optimistic concurrency in every existing-task write path',()=>{
  assert.match(server,/function assertProjectUpdateAuthorized\(existing = \{\}, req = \{\}\)/);
  assert.match(server,/error\.code = 'TASK_UPDATE_FORBIDDEN'/);

  const dedicatedStart=server.indexOf("app.post('/api/state/projects'");
  const dedicatedEnd=server.indexOf("app.delete('/api/state/projects",dedicatedStart);
  const dedicated=server.slice(dedicatedStart,dedicatedEnd);
  const dedicatedAuth=dedicated.indexOf('assertProjectUpdateAuthorized(existing, req)');
  const dedicatedReplay=dedicated.indexOf("existing.lastTaskMutationId || '') === mutationId");
  const dedicatedVersion=dedicated.indexOf('assertExpectedTaskVersion(existing, incoming, req.body || {})');
  assert.ok(dedicatedAuth >= 0 && dedicatedReplay >= 0 && dedicatedVersion >= 0
      && dedicatedAuth < dedicatedReplay && dedicatedReplay < dedicatedVersion,
    'Dedicated task writes must authorize before idempotent replay and version checks.');

  const broadStart=server.indexOf("app.post('/api/state',");
  const broadEnd=server.indexOf("app.get('/api/health",broadStart);
  const broad=server.slice(broadStart,broadEnd > broadStart ? broadEnd : undefined);
  const broadAuth=broad.indexOf('assertProjectUpdateAuthorized(existing,req)');
  const broadVersion=broad.indexOf('assertExpectedTaskVersion(existing,incoming,incoming)');
  assert.ok(broadAuth >= 0 && broadVersion >= 0 && broadAuth < broadVersion,
    'Legacy broad-state writes must reject unauthorized callers before checking task versions.');
});


test('full release verifier matrix runs every gate and aggregates all failures',()=>{
  const matrix=fs.readFileSync(new URL('../../scripts/full-release-verifier-matrix.mjs',import.meta.url),'utf8');
  const pkg=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
  for (const marker of [
    'security-package-audit','doctor','regression-guard','production-audit',
    'frontend-tests','frontend-runtime-bootstrap','backend-tests','finance','authentication','authorization',
    'database','files','reliability','release','frontend-ux','integration','build'
  ]) assert.match(matrix,new RegExp(`id:'${marker}'`));
  assert.match(matrix,/for \(const step of steps\) results\.push\(await runStep\(step\)\)/);
  assert.match(matrix,/const failures = results\.filter\(item => item\.status !== 'PASS'\)/);
  assert.match(matrix,/FULL RELEASE VERIFIER MATRIX/);
  assert.match(matrix,/os\.tmpdir\(\)/);
  assert.equal(pkg.scripts['verify:matrix'],'node scripts/full-release-verifier-matrix.mjs');
});



test('release certification cannot confuse a verifier-generated frontend build with bundled source',()=>{
  const deploy=fs.readFileSync(new URL('../../scripts/deploy-1.9.24-vps.sh',import.meta.url),'utf8');
  const audit=fs.readFileSync(new URL('../../scripts/security-package-audit.mjs',import.meta.url),'utf8');
  const certifyIndex=deploy.lastIndexOf('\nnpm run release:certify');
  const cleanupIndex=deploy.lastIndexOf('rm -rf "$STAGE/frontend/dist"',certifyIndex);
  assert.ok(cleanupIndex >= 0 && certifyIndex > cleanupIndex,
    'Deployment must remove the matrix build before the source-package audit in release certification.');
  assert.match(audit,/gitTrackedFiles/);
  assert.match(audit,/git', \['ls-files', '-z'\]/);
  assert.match(audit,/isBundledGeneratedArtifact\(file\)/);
});

test('phase 6 verifier exercises shared-object retention and grace-period trash collection',()=>{
  const verifier=fs.readFileSync(new URL('../../scripts/phase-6-file-storage-check.mjs',import.meta.url),'utf8');
  assert.match(verifier,/retained-shared-object/);
  assert.match(verifier,/retained-for-safe-gc/);
  assert.match(verifier,/COLLECT FILE STORAGE GARBAGE/);
  assert.match(verifier,/movedToTrash>=1/);
});


test('deployment opts into clean-install, environment, and backup gates before downtime',()=>{
  const deploy=fs.readFileSync(new URL('../../scripts/deploy-1.9.24-vps.sh',import.meta.url),'utf8');
  const matrix=fs.readFileSync(new URL('../../scripts/full-release-verifier-matrix.mjs',import.meta.url),'utf8');
  assert.match(deploy,/KALPA_VERIFY_INCLUDE_DEPLOYMENT_GATES=true/);
  for (const id of ['clean-install','production-environment','production-integrity-audit','backup-create','backup-verify','backup-status']) assert.match(matrix,new RegExp(`id:'${id}'`));
  assert.ok(deploy.indexOf('npm run verify:matrix') < deploy.indexOf('Stopping application writes'));
});
