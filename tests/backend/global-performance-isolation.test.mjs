import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { prepareFastSelectedRelationalWrite } from '../../backend/src/repositories/postgresStateRepository.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');

test('one row update keeps unrelated large workspace collections by reference', () => {
  const files = Array.from({ length: 20_000 }, (_, index) => ({ id:`file-${index}`, caseId:`case-${index % 200}`, name:`drawing-${index}.pdf` }));
  const chat = Array.from({ length: 5_000 }, (_, index) => ({ id:`chat-${index}`, text:`message ${index}` }));
  const notifications = Array.from({ length: 5_000 }, (_, index) => ({ id:`notification-${index}`, title:`notice ${index}` }));
  const base = {
    users:[{ id:'user-1', name:'Designer' }],
    cases:[{ id:'case-1', caseId:'CASE-1', status:'ASSIGNED', taskVersion:1 }],
    payments:[], performanceRecords:[], notifications, teamChat:chat,
    whatsappInbox:[], audit:[], attendanceLogs:[], files,
    deletedProjectIds:[], chatReads:{}
  };
  const incoming = {
    ...base,
    cases:[{ ...base.cases[0], status:'IN_PROGRESS', taskVersion:2 }]
  };
  const started = performance.now();
  const prepared = prepareFastSelectedRelationalWrite({
    persistedBaseState:base,
    incomingState:incoming,
    selectedCollections:['cases'],
    collectionRowIds:{ cases:['case-1'] }
  });
  const durationMs = performance.now() - started;
  assert.ok(prepared?.fastSelectedWrite);
  assert.equal(prepared.committedState.files, files);
  assert.equal(prepared.committedState.teamChat, chat);
  assert.equal(prepared.committedState.notifications, notifications);
  assert.equal(prepared.committedState.cases[0].status, 'IN_PROGRESS');
  assert.deepEqual(prepared.writeParts.cases.map(row => row.id), ['case-1']);
  assert.ok(durationMs < 1500, `selective preparation took ${durationMs.toFixed(1)}ms`);
});

test('complete rebuild of one table-backed collection avoids decomposing unrelated state', () => {
  const files = Array.from({ length: 10_000 }, (_, index) => ({ id:`file-${index}`, name:`file-${index}` }));
  const base = {
    users:[], cases:[], payments:[], performanceRecords:[{ id:'old', score:1 }],
    notifications:[], teamChat:[], whatsappInbox:[], audit:[], attendanceLogs:[], files,
    deletedProjectIds:[], chatReads:{}
  };
  const incoming = { ...base, performanceRecords:[{ id:'new', score:99 }] };
  const prepared = prepareFastSelectedRelationalWrite({
    persistedBaseState:base,
    incomingState:incoming,
    selectedCollections:['performanceRecords']
  });
  assert.ok(prepared?.fastSelectedWrite);
  assert.equal(prepared.committedState.files, files);
  assert.deepEqual(prepared.committedState.performanceRecords, [{ id:'new', score:99 }]);
  assert.deepEqual(prepared.writeParts.performanceRecords.map(row => row.id), ['new']);
});

test('routine writes use periodic snapshots, row deltas, and selected presence rows', () => {
  assert.match(server, /skipRevisionSnapshot:metadata\.forceRevisionSnapshot === true[\s\S]*metadata\.skipRevisionSnapshot \?\? true/);
  assert.match(server, /periodicRevisionSnapshot:metadata\.periodicRevisionSnapshot \?\? true/);
  assert.match(server, /rowDeltaIds:Object\.fromEntries/);
  assert.match(server, /workspaceCollectionChangeLog/);
  assert.match(server, /presence_heartbeat_batch[\s\S]*collectionRowIds:/);
  assert.match(repository, /Special state collections are small/);
  assert.match(repository, /cacheTopLevel:true/);
});

test('chat attachments do not mutate or rewrite the private file registry', () => {
  const start = server.indexOf("app.post('/api/chat'");
  const end = server.indexOf("app.patch('/api/chat/:id'", start);
  const route = server.slice(start, end);
  assert.match(route, /const chatFile=structuredClone\(resolved\)/);
  assert.doesNotMatch(route, /resolved\.chatScope=/);
  assert.doesNotMatch(route, /collections\.push\('files'\)/);
});

test('profile photo snapshots resolve the actor before selecting the user row', () => {
  const start = server.indexOf("app.post('/api/profile/photo'");
  const end = server.indexOf('function normalizeFilePurposeType', start);
  const route = server.slice(start, end);
  assert.ok(route.indexOf('const actor = requestActor(req)') < route.indexOf('const d = selectiveDb'));
});
