import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  prepareFastSelectedRelationalWrite,
  stateSnapshotHash
} from '../../backend/src/repositories/postgresStateRepository.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');

const baseState = overrides => ({
  users:[], cases:[], payments:[], performanceRecords:[], notifications:[],
  teamChat:[], whatsappInbox:[], audit:[], attendanceLogs:[], files:[],
  deletedProjectIds:[], chatReads:{}, ...(overrides || {})
});

test('cached integrity hashing is byte-compatible with the canonical full hash', () => {
  const state = baseState({
    cases:[{ id:'case-1', nested:{ z:2, a:1 } }],
    files:Array.from({ length:2_000 }, (_, index) => ({ id:`file-${index}`, meta:{ b:index, a:'x' } })),
    performanceRecords:Array.from({ length:1_000 }, (_, index) => ({ id:`perf-${index}`, score:index }))
  });
  const canonical = stateSnapshotHash(state);
  const cachedFirst = stateSnapshotHash(state, { cacheTopLevel:true });
  const cachedSecond = stateSnapshotHash(state, { cacheTopLevel:true });
  assert.equal(cachedFirst, canonical);
  assert.equal(cachedSecond, canonical);
});

test('one changed collection reuses cached unrelated collections without weakening the hash', () => {
  const files = Array.from({ length:20_000 }, (_, index) => ({ id:`file-${index}`, name:`file-${index}.pdf` }));
  const performanceRecords = Array.from({ length:10_000 }, (_, index) => ({ id:`perf-${index}`, score:index }));
  const original = baseState({ files, performanceRecords, cases:[{ id:'case-1', status:'ASSIGNED' }] });
  stateSnapshotHash(original, { cacheTopLevel:true });
  const next = { ...original, cases:[{ id:'case-1', status:'COMPLETED' }] };
  const started = performance.now();
  const cached = stateSnapshotHash(next, { cacheTopLevel:true });
  const elapsed = performance.now() - started;
  assert.equal(cached, stateSnapshotHash(next));
  assert.ok(elapsed < 500, `cached selected hash took ${elapsed.toFixed(1)}ms`);
});

test('row-level deletion removes the physical row without rebuilding unrelated state', () => {
  const files = Array.from({ length:10_000 }, (_, index) => ({ id:`file-${index}` }));
  const existing = baseState({
    files,
    cases:[
      { id:'case-1', caseId:'CASE-1', status:'ASSIGNED' },
      { id:'case-2', caseId:'CASE-2', status:'ASSIGNED' }
    ]
  });
  const incoming = { ...existing, cases:[existing.cases[1]] };
  const prepared = prepareFastSelectedRelationalWrite({
    persistedBaseState:existing,
    incomingState:incoming,
    selectedCollections:['cases'],
    collectionRowIds:{ cases:['case-1'] }
  });
  assert.deepEqual(prepared.rowDeletions.get('cases'), ['case-1']);
  assert.deepEqual(prepared.committedState.cases.map(item => item.id), ['case-2']);
  assert.equal(prepared.committedState.files, files);
  assert.deepEqual(prepared.writeParts.cases, []);
});

test('chat reads and deleted task ids stay on the selective fast path', () => {
  const files = Array.from({ length:15_000 }, (_, index) => ({ id:`file-${index}` }));
  const existing = baseState({ files, deletedProjectIds:['old'], chatReads:{ ADMIN:['m1'] } });
  const incoming = { ...existing, deletedProjectIds:['old','case-2'], chatReads:{ ADMIN:['m1','m2'] } };
  const prepared = prepareFastSelectedRelationalWrite({
    persistedBaseState:existing,
    incomingState:incoming,
    selectedCollections:['deletedProjectIds','chatReads']
  });
  assert.ok(prepared.fastSelectedWrite);
  assert.equal(prepared.committedState.files, files);
  assert.deepEqual(prepared.committedState.deletedProjectIds, ['old','case-2']);
  assert.deepEqual(prepared.committedState.chatReads.ADMIN, ['m1','m2']);
});

test('read-all and chat-read endpoints select exact rows instead of cloning whole collections', () => {
  const chatStart = server.indexOf("app.post('/api/chat/read'");
  const chatEnd = server.indexOf("app.post('/api/notifications'", chatStart);
  const chatRoute = server.slice(chatStart, chatEnd);
  assert.match(chatRoute, /const readable=\[\]/);
  assert.match(chatRoute, /changedNotificationIds/);
  assert.match(chatRoute, /collectionRowIds/);
  assert.doesNotMatch(chatRoute, /cloneAll:\s*\['teamChat','notifications'\]/);

  const notificationStart = server.indexOf("app.post('/api/notifications/read-all'");
  const notificationEnd = server.indexOf("app.post('/api/whatsapp/incoming'", notificationStart);
  const notificationRoute = server.slice(notificationStart, notificationEnd);
  assert.match(notificationRoute, /const changedIds=/);
  assert.match(notificationRoute, /collectionRowIds:\{notifications:changedIds\}/);
});

test('all payment endpoints return compact task finance patches', () => {
  const primaryStart = server.indexOf("app.post('/api/state/projects/:id/payment-status'");
  const primaryEnd = server.indexOf("app.post('/api/cases/:id/payment'", primaryStart);
  const primary = server.slice(primaryStart, primaryEnd);
  assert.match(primary, /financeResponsePatch\(updated\)/);

  const legacyStart = primaryEnd;
  const legacyEnd = server.indexOf("app.post('/api/cases/:id/timeline'", legacyStart);
  const legacy = server.slice(legacyStart, legacyEnd);
  assert.match(legacy, /financeResponsePatch\(c\)/);
  assert.doesNotMatch(legacy, /project:c,case:c/);
});
