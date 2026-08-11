import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../../frontend/src/App.jsx',import.meta.url),'utf8');
const taskService=fs.readFileSync(new URL('../../frontend/src/services/taskService.js',import.meta.url),'utf8');
const fileService=fs.readFileSync(new URL('../../frontend/src/services/fileService.js',import.meta.url),'utf8');

test('case edits preserve the immutable database ID and change only the display ID',()=>{
  const start=app.indexOf('const handleSaveCaseEdit');
  const end=app.indexOf('const handlePauseDrafting',start);
  const block=app.slice(start,end);
  assert.match(block,/id: project\.id/);
  assert.match(block,/displayId: nextTaskId/);
  assert.match(block,/caseId: nextTaskId/);
  assert.doesNotMatch(block,/supersedesTaskId:/);
});

test('task saves carry optimistic concurrency and client-owned idempotency metadata',()=>{
  assert.match(taskService,/expectedTaskVersion/);
  assert.match(taskService,/mutationId/);
  assert.match(taskService,/normalizedTask\.clientMutationId/);
  assert.doesNotMatch(taskService,/mutationId \|\| normalizedTask\.lastTaskMutationId/);
  const pendingStart=app.indexOf('const rememberPendingCreatedProject');
  const pendingEnd=app.indexOf('const markPendingCreatedAttempt',pendingStart);
  assert.doesNotMatch(app.slice(pendingStart,pendingEnd),/project\.lastTaskMutationId/);
  assert.match(app,/TASK_VERSION_CONFLICT/);
  assert.match(app,/createTaskMutationId/);
  assert.match(app,/expectedTaskVersion/);
});

test('durable task outbox is actor scoped and clears only matching mutations',()=>{
  assert.match(app,/getPendingCreatedRecords\(operationalActorKey\(currentUser\)\)/);
  assert.match(app,/serverProject\.lastTaskMutationId/);
  assert.match(app,/record\.mutationId/);
  const clearStart=app.indexOf('const clearRoleScopedOperationalCaches');
  const clearEnd=app.indexOf('const normalizeTeamUsers',clearStart);
  const clearBlock=app.slice(clearStart,clearEnd);
  assert.doesNotMatch(clearBlock,/kalpa_pending_created_projects/);
  assert.doesNotMatch(clearBlock,/kalpa_pending_deleted_project_ids/);
});

test('file uploads and deletes consume committed server task patches without duplicate task writes',()=>{
  assert.match(fileService,/_serverCase: payload\.case \|\| payload\.project \|\| null/);
  const uploadStart=app.indexOf('const handleFileUpload');
  const uploadEnd=app.indexOf('const uploadSupportingAttachments',uploadStart);
  const uploadBlock=app.slice(uploadStart,uploadEnd);
  assert.match(uploadBlock,/acceptServerProject\(latestConfirmed\)/);
  const deleteStart=app.indexOf('const handleFileDelete');
  const deleteEnd=app.indexOf('const handleLedgerScreenshot',deleteStart);
  const deleteBlock=app.slice(deleteStart,deleteEnd);
  assert.match(deleteBlock,/acceptServerProject\(confirmed\)/);
  assert.doesNotMatch(deleteBlock,/onUpdateProject\(updatedProject/);
});

test('payment receipts never store internal server response metadata in finance state',()=>{
  const start=app.indexOf('const handleLedgerScreenshot');
  const end=app.indexOf('const handleAddSubTask',start);
  const block=app.slice(start,end);
  assert.match(block,/delete receipt\._serverCase/);
  assert.match(block,/delete receipt\._persistence/);
});

test('durable delete outbox is actor scoped, versioned, and replays one stable mutation',()=>{
  assert.match(app,/getPendingDeletedRecords\(deleteActorKey\)/);
  assert.match(app,/markPendingDeletedAttempt\(id, deleteActorKey\)/);
  assert.match(app,/expectedTaskVersion:Number\(record\?\.expectedTaskVersion \|\| 0\)/);
  assert.match(app,/mutationId:String\(record\?\.mutationId \|\| ''\)/);
  assert.match(app,/rememberPendingDeletedProjects\(deleteIds, \{[\s\S]*expectedTaskVersion,[\s\S]*mutationId:deleteMutationId/);
  assert.match(app,/forgetPendingDeletedProjects\(asArray\(record\?\.groupIds\)\.length \? record\.groupIds : \[id\], \{ actorId: deleteActorKey \}\)/);
  assert.match(app,/forgetDeletedProjects\(groupIds\)/);
  assert.match(app,/await refreshWorkspaceSnapshot\(\)\.catch\(\(\)=>\{\}\)/);
});

test('authoritative task writes never publish an unconfirmed optimistic task to the cloud mirror',()=>{
  const updateStart=app.indexOf('const handleUpdateProject');
  const updateEnd=app.indexOf('const handlePaymentStatusChange',updateStart);
  const block=app.slice(updateStart,updateEnd);
  assert.match(block,/if \(!USE_BACKEND_STATE && firebaseUser && !isLocalMock\)/);
  const backendStart=block.indexOf('if (USE_BACKEND_STATE && backendStateReady && isDbReady)');
  const confirmedSnapshot=block.indexOf("applyProjectSnapshot([confirmed],{source:'task-update-confirmed',replaceIds})",backendStart);
  const confirmedMirror=block.indexOf("stripLargeLocalFilesForCloud(confirmed)",confirmedSnapshot);
  assert.ok(backendStart >= 0 && confirmedSnapshot > backendStart && confirmedMirror > confirmedSnapshot,
    'Cloud mirror updates must use the server-confirmed task only after authoritative acceptance.');
});

test('stale task deletion is cancelled, restored, and never deletes the backend-mode cloud mirror first',()=>{
  const start=app.indexOf('const handleDeleteTask');
  const end=app.indexOf('const handleSendMessage',start);
  const block=app.slice(start,end);
  assert.match(block,/const expectedTaskVersion=Number\(target\?\.taskVersion \|\| 0\)/);
  assert.match(block,/const deleteMutationId=createTaskMutationId\('delete'\)/);
  assert.match(block,/expectedTaskVersion,[\s\S]*mutationId:deleteMutationId/);
  assert.match(block,/forgetDeletedProjects\(deleteIds\)/);
  assert.match(block,/await refreshWorkspaceSnapshot\(\)\.catch\(\(\)=>\{\}\)/);
  const backendDelete=block.indexOf('const data = await deleteTaskApi');
  const confirmedCloudDelete=block.indexOf("Confirmed task cloud mirror delete failed",backendDelete);
  const legacyCloudDelete=block.indexOf('if (!USE_BACKEND_STATE && firebaseUser && !isLocalMock)',backendDelete);
  assert.ok(backendDelete >= 0 && confirmedCloudDelete > backendDelete && legacyCloudDelete > backendDelete,
    'Backend mode must wait for authoritative delete confirmation before touching its cloud mirror.');
});

test('renamed tasks cannot hide themselves through their own previous-id aliases',()=>{
  const start=app.indexOf('const filterDeletedProjects');
  const end=app.indexOf('// Persist assignment changes',start);
  const block=app.slice(start,end);
  assert.match(block,/const ownIds=new Set\(\[p\?\.id,p\?\.caseId,p\?\.displayId\]/);
  assert.match(block,/!ownIds\.has\(String\(id\)\)/);
  assert.match(block,/!ownIds\.has\(String\(p\.supersedesTaskId\)\)/);
});

test('permanent validation and authorization failures are rolled back instead of retried forever',()=>{
  assert.match(app,/const PERMANENT_TASK_WRITE_CODES = new Set/);
  assert.match(app,/if \(isPermanentTaskWriteError\(error\)\)/);
  assert.match(app,/const restored=knownExisting \? mergeProjectsByFreshness\(withoutRejected,\[knownExisting\]\) : withoutRejected/);
  assert.match(app,/Pending task write was rejected permanently and removed from the retry outbox/);
});

test('new-task validation or version rejection removes the optimistic task instead of leaving a ghost entry',()=>{
  const start=app.indexOf("const createMutationId=createTaskMutationId('create')");
  const end=app.indexOf('// The task itself is now visible immediately',start);
  const block=app.slice(start,end);
  assert.match(block,/versionRejected \|\| isPermanentTaskWriteError\(saveErr\)/);
  assert.match(block,/forgetPendingCreatedProjects\(newP\.id,newP\.caseId,newP\.displayId\)/);
  assert.match(block,/forgetRecentCreatedProjects\(newP\.id,newP\.caseId,newP\.displayId\)/);
  assert.match(block,/rejectedIds/);
});

test('retryable task updates retain a rollback snapshot and stale retries cannot leave optimistic state behind',()=>{
  assert.match(app,/rollbackProject:options\?\.rollbackProject \? sanitizeProjectForCache\(options\.rollbackProject\)/);
  assert.match(app,/rollbackProject:knownExisting \|\| null/);
  assert.match(app,/pending-task-version-rollback/);
  assert.match(app,/pending-task-permanent-rollback/);
  const updateStart=app.indexOf('const handleUpdateProject');
  const updateEnd=app.indexOf('const handlePaymentStatusChange',updateStart);
  const block=app.slice(updateStart,updateEnd);
  const conflict=block.indexOf("['TASK_VERSION_CONFLICT','TASK_VERSION_REQUIRED'].includes");
  const restore=block.indexOf('const restored=knownExisting ? mergeProjectsByFreshness',conflict);
  const refresh=block.indexOf('await refreshWorkspaceSnapshot().catch(()=>{})',conflict);
  assert.ok(conflict >= 0 && restore > conflict && refresh > restore,
    'A version conflict must restore the last known task immediately before attempting a network refresh.');
});

test('new task cloud mirror waits for backend confirmation in backend-authoritative mode',()=>{
  const start=app.indexOf("const createMutationId=createTaskMutationId('create')");
  const end=app.indexOf('if (!USE_BACKEND_STATE && newP.assignedTo',start);
  const block=app.slice(start,end);
  assert.match(block,/let projectConfirmedByBackend = !USE_BACKEND_STATE/);
  assert.match(block,/if \(firebaseUser && !isLocalMock && \(!USE_BACKEND_STATE \|\| projectConfirmedByBackend\)\)/);
});

test('background and pre-upload task confirmation mirror only the confirmed server record',()=>{
  assert.match(app,/Pre-upload confirmed task cloud mirror update failed/);
  assert.match(app,/stripLargeLocalFilesForCloud\(confirmed\)/);
  assert.match(app,/Pending confirmed task cloud mirror update failed/);
  assert.match(app,/stripLargeLocalFilesForCloud\(savedProject\)/);
});

test('duplicate edited task references are treated as permanent conflicts, not retried writes',()=>{
  assert.match(app,/TASK_DISPLAY_ID_CONFLICT/);
});
