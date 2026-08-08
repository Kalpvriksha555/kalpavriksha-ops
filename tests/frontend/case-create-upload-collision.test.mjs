import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../../frontend/src/App.jsx',import.meta.url),'utf8');
const taskService=fs.readFileSync(new URL('../../frontend/src/services/taskService.js',import.meta.url),'utf8');

test('task API carries explicit create versus update intent',()=>{
  assert.match(taskService,/operation = ''/);
  assert.match(taskService,/operation:String\(operation \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(app,/operation:record\.operation/);
  assert.match(app,/operation:isCreate \? 'create' : 'update'/);
  assert.match(app,/operation:'create'/);
});

test('a server-allocated task ID replaces the optimistic ID before source uploads',()=>{
  const createStart=app.indexOf("const createMutationId=createTaskMutationId('create')");
  const createEnd=app.indexOf('if (firebaseUser && !isLocalMock)',createStart);
  const createFlow=app.slice(createStart,createEnd);
  const replacement=createFlow.indexOf('replaceIds=projectIdentityMatches(confirmedProject,newP)');
  const apply=createFlow.indexOf("source: 'create-confirmed', replaceIds");
  const upload=createFlow.indexOf("uploadProjectFile(file,confirmedProject.id || confirmedProject.caseId");
  assert.ok(replacement >= 0 && apply > replacement && upload > apply);
  assert.match(createFlow,/forgetRecentCreatedProjects\(replaceIds\)/);
});

test('idempotent background confirmation also removes an obsolete optimistic ID',()=>{
  const start=app.indexOf('const flushPendingCreatedProjects');
  const end=app.indexOf('const timer = setInterval(flushPendingCreatedProjects',start);
  const flow=app.slice(start,end);
  assert.match(flow,/projectIdentityMatches\(savedProject,project\) \? \[\] : \[project\.id,project\.caseId,project\.displayId\]/);
  assert.match(flow,/source:'pending-task-confirmed',replaceIds/);
});
