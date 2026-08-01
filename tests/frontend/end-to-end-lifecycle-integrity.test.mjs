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

test('task saves carry optimistic concurrency and idempotency metadata',()=>{
  assert.match(taskService,/expectedTaskVersion/);
  assert.match(taskService,/mutationId/);
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

test('durable delete outbox is actor scoped so another signed-in user cannot retry it',()=>{
  assert.match(app,/getPendingDeletedProjectIds\(deleteActorKey\)/);
  assert.match(app,/markPendingDeletedAttempt\(id, deleteActorKey\)/);
  assert.match(app,/rememberPendingDeletedProjects\(deleteIds, \{ actorId: operationalActorKey\(currentUser\) \}\)/);
  assert.match(app,/forgetPendingDeletedProjects\(id, \{ actorId: deleteActorKey \}\)/);
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

test('duplicate edited task references are treated as permanent conflicts, not retried writes',()=>{
  assert.match(app,/TASK_DISPLAY_ID_CONFLICT/);
});
