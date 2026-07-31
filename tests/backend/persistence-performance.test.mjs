import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareRelationalWrite } from '../../backend/src/repositories/postgresStateRepository.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');

test('presence heartbeat is coalesced and does not clone or persist the complete state per beat', () => {
  const start = server.indexOf("if (safeAction === 'heartbeat')");
  const end = server.indexOf('const d = db();', start);
  assert.ok(start > 0 && end > start);
  const branch = server.slice(start, end);
  assert.match(branch, /replacePresenceSliceInMemory\(presenceState\)/);
  assert.match(branch, /schedulePresenceFlush\(\)/);
  assert.doesNotMatch(branch, /\bdb\(\)/);
  assert.doesNotMatch(branch, /await save\(/);
});

test('presence persistence is delayed, coalesced and excluded from full revision snapshots', () => {
  assert.match(server, /PRESENCE_HEARTBEAT_FLUSH_MS/);
  assert.match(server, /flushPresenceHeartbeatBatch/);
  assert.match(server, /skipRevisionSnapshot:true/);
  assert.match(server, /collections:\['users','attendanceLogs'\]/);
  assert.match(repository, /const skipRevisionSnapshot = metadata\.skipRevisionSnapshot === true/);
  assert.match(repository, /if \(!skipRevisionSnapshot\) \{\s*await client\.query\(\s*`INSERT INTO state_revisions/s);
});

test('hot task and file paths sync only their changed relational collections', () => {
  assert.match(server, /reason:'file_upload',[\s\S]*collections:\['files'\]/);
  assert.match(server, /reason:existing \? 'task_update' : 'task_create',[\s\S]*collections:\['cases','audit'\]/);
  assert.match(repository, /syncRelationalParts\(client, preparedWrite\.writeParts, metadata\.collections, preparedWrite\.rowSelections\)/);
  assert.match(repository, /Unknown relational collection selection/);
  assert.match(repository, /const committedState = selectedCollections \? recomposeState\(committedParts\) : normalized/);
  assert.match(server, /collectionRowIds:\{[\s\S]*cases:\[String\(saved\.id \|\| saved\.caseId\)\]/);
  assert.match(server, /collectionRowIds:\{ files:\[String\(file\.id\)\] \}/);
  assert.match(repository, /JSON\.stringify\(committedState\)/);
});

test('foreground writes block background heartbeat flush from taking queue priority', () => {
  assert.match(server, /activeForegroundWriteRequests/);
  assert.match(server, /req\.path !== '\/presence'/);
  assert.match(server, /activeForegroundWriteRequests > 0 \|\| persistenceQueueDepth > 0 \|\| persistenceInFlight > 0/);
});


test('durable presence actions mark the exact generation included in their snapshot', () => {
  assert.match(server, /presenceMutationGeneration \+= 1;\s*snapshotPresenceGenerations\.set\(d, presenceMutationGeneration\);/);
});


test('row-level relational writes preserve legacy rows and only emit the requested new row', () => {
  const existing = {
    files:[
      { id:'legacy-orphan', sortOrder:0, payload:{ id:'legacy-orphan', caseId:'missing-case' } },
      { id:'existing', sortOrder:1, payload:{ id:'existing', caseId:'case-1' } }
    ]
  };
  const incoming = {
    files:[
      { id:'new-file', sortOrder:0, payload:{ id:'new-file', caseId:'case-1' } },
      { id:'legacy-orphan', sortOrder:1, payload:{ id:'legacy-orphan', caseId:'missing-case', url:'/normalized' } },
      { id:'existing', sortOrder:2, payload:{ id:'existing', caseId:'case-1' } }
    ]
  };
  const prepared = prepareRelationalWrite(existing, incoming, ['files'], { files:['new-file'] });
  assert.deepEqual(prepared.writeParts.files.map(row => row.id), ['new-file']);
  assert.equal(prepared.committedParts.files.find(row => row.id === 'legacy-orphan').payload.url, undefined);
  assert.equal(prepared.committedParts.files.find(row => row.id === 'new-file').payload.caseId, 'case-1');
  assert.equal(prepared.rowSelections.has('files'), true);
});

import { mergeLatestPresenceIntoSnapshot, preserveDirtyPresenceAfterReload } from '../../backend/src/services/persistenceBackpressureService.js';

test('a foreground write cannot overwrite a newer heartbeat or attendance slice', () => {
  const staleSnapshot = {
    users:[{ id:'u1', lastSeenAt:100 }],
    attendanceLogs:[{ id:'a1', lastSeenAt:100 }],
    cases:[{ id:'c1', status:'Drafting' }]
  };
  const liveState = {
    users:[{ id:'u1', lastSeenAt:200 }],
    attendanceLogs:[{ id:'a1', lastSeenAt:200 }],
    cases:[{ id:'c1', status:'Lead Received' }]
  };
  const merged = mergeLatestPresenceIntoSnapshot({
    snapshot:staleSnapshot,
    liveState,
    snapshotGeneration:3,
    liveGeneration:4
  });
  assert.equal(merged.includedPresenceGeneration, 4);
  assert.equal(merged.state.users[0].lastSeenAt, 200);
  assert.equal(merged.state.attendanceLogs[0].lastSeenAt, 200);
  assert.equal(merged.state.cases[0].status, 'Drafting');
});

test('database reload after a failed write preserves unflushed presence', () => {
  const restored = preserveDirtyPresenceAfterReload({
    committedState:{ users:[{ id:'u1', lastSeenAt:100 }], attendanceLogs:[], cases:[{ id:'c1' }] },
    liveState:{ users:[{ id:'u1', lastSeenAt:300 }], attendanceLogs:[{ id:'a1', lastSeenAt:300 }] },
    mutationGeneration:8,
    persistedGeneration:7
  });
  assert.equal(restored.users[0].lastSeenAt, 300);
  assert.equal(restored.attendanceLogs[0].lastSeenAt, 300);
  assert.equal(restored.cases[0].id, 'c1');
});


test('backend request timeout is aligned with supported large-file upload duration', () => {
  assert.match(server, /boundedEnvNumber\('HTTP_REQUEST_TIMEOUT_MS',35 \* 60 \* 1000,5 \* 60 \* 1000,60 \* 60 \* 1000\)/);
  assert.match(server, /httpServer\.requestTimeout = requestTimeoutMs/);
  assert.match(server, /httpServer\.headersTimeout = headersTimeoutMs/);
});
