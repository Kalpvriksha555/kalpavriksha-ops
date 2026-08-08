import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');

test('routine writes keep relational durability while reducing foreground recovery-snapshot frequency', () => {
  assert.match(server, /STATE_REVISION_SNAPSHOT_INTERVAL[^\n]*100/);
  assert.match(server, /STATE_REVISION_SNAPSHOT_MAX_AGE_MINUTES[^\n]*60/);
  assert.match(server, /periodicRevisionSnapshot:metadata\.periodicRevisionSnapshot \?\? true/);
  assert.match(repository, /SET state_version=\$2,snapshot_hash=\$3,entity_counts=\$4::jsonb/);
  assert.match(repository, /WHERE key=\$1 AND state_version=\$5 AND snapshot_hash=\$6/);
});

test('case response shaping avoids repeated full deep clones', () => {
  assert.match(server, /const sanitizedCaseResponseCache = new WeakMap\(\)/);
  assert.match(server, /if \(normalizedRole === 'ADMIN'\) return records/);
  assert.match(server, /cached\?\.stamp === stamp/);
});

test('special relational collections are persisted in batched SQL statements', () => {
  assert.match(repository, /unnest\(\$1::text\[\],\$2::integer\[\]\)/);
  assert.match(repository, /unnest\(\$1::text\[\],\$2::text\[\]\).*reader_key/s);
  assert.match(repository, /unnest\(\$1::text\[\],\$2::text\[\]\).*payload_text/s);
  assert.doesNotMatch(repository, /for \(const row of readRows\) \{\s*await client\.query/);
});

import { prepareFastSelectedRelationalWrite, stateSnapshotHash } from '../../backend/src/repositories/postgresStateRepository.js';

test('cached integrity serialization remains byte-equivalent to full canonical hashing', () => {
  const state = {
    cases:[{ id:'case-1', z:2, a:{ y:2, x:1 } }, null, 'value', undefined],
    notifications:[{ id:'notification-1', readBy:[] }],
    chatReads:{ admin:['message-1'] }
  };
  assert.equal(stateSnapshotHash(state, { cacheTopLevel:true }), stateSnapshotHash(state));
});

test('row-level selected writes preserve unrelated records inside the changed collection', () => {
  const oldAudit = Array.from({ length:10_000 }, (_, index) => ({ id:`audit-${index}`, action:`event ${index}` }));
  const incomingAudit = [{ id:'audit-new', action:'new event' }, ...oldAudit];
  const base = {
    users:[], cases:[], payments:[], performanceRecords:[], notifications:[], teamChat:[],
    whatsappInbox:[], audit:oldAudit, attendanceLogs:[], files:[], deletedProjectIds:[], chatReads:{}
  };
  const incoming = { ...base, audit:incomingAudit };
  const prepared = prepareFastSelectedRelationalWrite({
    persistedBaseState:base,
    incomingState:incoming,
    selectedCollections:['audit'],
    collectionRowIds:{ audit:['audit-new'] }
  });
  assert.equal(prepared.committedState.audit[1], oldAudit[0]);
  assert.equal(prepared.committedState.audit.at(-1), oldAudit.at(-1));
  assert.equal(prepared.writeParts.audit.length, 1);
});


test('selected in-place mutations invalidate row serialization before integrity hashing', () => {
  const record = { id:'case-1', status:'ASSIGNED', taskVersion:1 };
  const base = {
    users:[], cases:[record], payments:[], performanceRecords:[], notifications:[], teamChat:[],
    whatsappInbox:[], audit:[], attendanceLogs:[], files:[], deletedProjectIds:[], chatReads:{}
  };
  const oldHash = stateSnapshotHash(base, { cacheTopLevel:true });
  record.status = 'IN_PROGRESS';
  record.taskVersion = 2;
  const incoming = { ...base, cases:[record] };
  const prepared = prepareFastSelectedRelationalWrite({
    persistedBaseState:base,
    incomingState:incoming,
    selectedCollections:['cases'],
    collectionRowIds:{ cases:['case-1'] }
  });
  const cachedHash = stateSnapshotHash(prepared.committedState, { cacheTopLevel:true });
  const fullHash = stateSnapshotHash(prepared.committedState);
  assert.equal(cachedHash, fullHash);
  assert.notEqual(cachedHash, oldHash);
});
