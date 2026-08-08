import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../../backend/src/server.js',import.meta.url),'utf8');

test('upload route can resolve a stale optimistic task id through the committed create mutation id',()=>{
  const start=server.indexOf("app.post('/api/files/upload'");
  const end=server.indexOf("app.get('/api/files/:id'",start);
  const route=server.slice(start,end);
  assert.match(route,/taskMutationId=textValue/);
  assert.match(route,/const findUploadTarget=/);
  assert.match(route,/lastTaskMutationId \|\| ''\)===taskMutationId/);
  assert.match(route,/taskDb\(resolvedProjectId,\{files:true\}\)/);
  assert.match(route,/docPayload\(req\.file,actor\.name,actor\.role,purpose,resolvedProjectId\)/);
  assert.match(route,/requestedProjectId:projectId,resolvedProjectId/);
});

test('task create mutation identity wins over a stale optimistic id that now belongs to another task',()=>{
  const start=server.indexOf("app.post('/api/files/upload'");
  const end=server.indexOf("app.get('/api/files/:id'",start);
  const route=server.slice(start,end);
  const helperStart=route.indexOf('const findUploadTarget=');
  const helperEnd=route.indexOf('const authorizeUpload=',helperStart);
  const helper=route.slice(helperStart,helperEnd);
  const mutationLookup=helper.indexOf('lastTaskMutationId');
  const idLookup=helper.indexOf('findCaseByAnyId');
  assert.ok(mutationLookup >= 0, 'create mutation lookup must exist');
  assert.ok(idLookup > mutationLookup, 'create mutation lookup must run before stale optimistic id lookup');
  assert.match(helper,/if \(taskMutationId\)/);
  assert.match(helper,/if \(byMutation\) return byMutation/);
});
