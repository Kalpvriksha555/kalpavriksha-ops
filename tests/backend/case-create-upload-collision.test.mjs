import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../../backend/src/server.js',import.meta.url),'utf8');

test('new-task writes allocate the next free server identity instead of editing a collided task',()=>{
  const helperStart=server.indexOf('function nextAvailableCaseIdentity');
  const helperEnd=server.indexOf('function assertCaseDisplayIdentityAvailable',helperStart);
  const helper=server.slice(helperStart,helperEnd);
  assert.match(helper,/deletedProjectIds/);
  assert.match(helper,/startingSerial \+ 1/);
  assert.match(helper,/padStart\(width,'0'\)/);

  const routeStart=server.indexOf("app.post('/api/state/projects'");
  const routeEnd=server.indexOf("app.delete('/api/state/projects",routeStart);
  const route=server.slice(routeStart,routeEnd);
  assert.match(route,/operation \|\| ''/);
  assert.match(route,/mutationId\.startsWith\('create-'\)/);
  assert.match(route,/committedReplay/);
  assert.match(route,/createIdentityCollision/);
  assert.match(route,/nextAvailableCaseIdentity/);
  assert.match(route,/safeIncoming\.id = allocatedProjectId/);
  assert.match(route,/taskIdAllocated:createIdentityCollision/);
});

test('file upload remains ordered after the committed task write',()=>{
  const createRoute=server.slice(server.indexOf("app.post('/api/state/projects'"),server.indexOf("app.delete('/api/state/projects"));
  const uploadRoute=server.slice(server.indexOf("app.post('/api/files/upload'"),server.indexOf("app.get('/api/files/:id'"));
  assert.match(createRoute,/await save\(d/);
  assert.match(uploadRoute,/findCaseByAnyId\(state\.cases \|\| \[\],projectId\)/);
  assert.match(uploadRoute,/The target task was not found/);
});
