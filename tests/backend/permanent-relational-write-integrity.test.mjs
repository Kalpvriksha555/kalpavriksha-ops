import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalJsonClone,
  prepareFastSelectedRelationalWrite,
  prepareRelationalWrite,
  stableStringify,
  stateSnapshotHash
} from '../../backend/src/repositories/postgresStateRepository.js';
import { createOperationalJobStore } from '../../backend/src/services/operationalReliabilityService.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');
const deployment = fs.readFileSync(new URL('../../scripts/deploy-1.9.29-vps.sh', import.meta.url), 'utf8');

const baseState = overrides => ({
  users:[], cases:[], payments:[], performanceRecords:[], notifications:[],
  teamChat:[], whatsappInbox:[], audit:[], attendanceLogs:[], files:[],
  deletedProjectIds:[], chatReads:{}, ...(overrides || {})
});

test('canonical hashing exactly follows PostgreSQL JSON representation semantics', () => {
  const timestamp = new Date('2026-08-02T10:00:00.000Z');
  const state = {
    timestamp,
    omitted:undefined,
    array:[undefined, Number.NaN, timestamp],
    nested:{ z:2, a:1, omitted:undefined }
  };
  const jsonRoundTrip = JSON.parse(JSON.stringify(state));
  assert.equal(stableStringify(state), stableStringify(jsonRoundTrip));
  assert.equal(stateSnapshotHash(state), stateSnapshotHash(jsonRoundTrip));
  assert.equal(stateSnapshotHash(state, { cacheTopLevel:true }), stateSnapshotHash(jsonRoundTrip));
});

test('non-JSON state is rejected before a relational transaction can publish metadata', () => {
  assert.throws(
    () => canonicalJsonClone({ amount:1n }, 'payment row'),
    error => error?.code === 'RELATIONAL_NON_JSON_STATE' && /payment row/.test(error.message)
  );
});

test('row selection prefers an immutable primary id over a colliding legacy alias', () => {
  const duplicateAlias = { id:'case-1', payload:'legacy duplicate' };
  const base = baseState({
    cases:[
      { id:'case-1', caseId:'CASE-1', status:'ASSIGNED' },
      duplicateAlias
    ],
    files:Array.from({ length:2_000 }, (_, index) => ({ id:`file-${index}` }))
  });
  const incoming = { ...base, cases:[{ ...base.cases[0], status:'IN_PROGRESS' }, duplicateAlias] };
  const prepared = prepareFastSelectedRelationalWrite({
    persistedBaseState:base,
    incomingState:incoming,
    selectedCollections:['cases'],
    collectionRowIds:{ cases:['case-1'] }
  });
  assert.deepEqual(prepared.writeParts.cases.map(row => row.id), ['case-1']);
  assert.equal(prepared.committedState.cases.find(row => row.id === 'case-1').status, 'IN_PROGRESS');
  assert.equal(prepared.committedState.files, base.files);
});

test('selected rows are JSON-canonicalized before hashing and PostgreSQL upsert', () => {
  const base = baseState({ attendanceLogs:[{ id:'u1_2026-08-02', lastTick:'2026-08-02T10:00:00.000Z' }] });
  const incoming = {
    ...base,
    attendanceLogs:[{ id:'u1_2026-08-02', lastTick:new Date('2026-08-02T10:05:00.000Z'), optional:undefined }]
  };
  const prepared = prepareFastSelectedRelationalWrite({
    persistedBaseState:base,
    incomingState:incoming,
    selectedCollections:['attendanceLogs'],
    collectionRowIds:{ attendanceLogs:['u1_2026-08-02'] }
  });
  assert.equal(prepared.writeParts.attendanceLogs[0].payload.lastTick, '2026-08-02T10:05:00.000Z');
  assert.equal('optional' in prepared.writeParts.attendanceLogs[0].payload, false);
  assert.equal(stateSnapshotHash(prepared.committedState, { cacheTopLevel:true }), stateSnapshotHash(prepared.committedState));
});

test('generic selected-row preparation also canonicalizes payloads before persistence', () => {
  const existingParts = { attendanceLogs:[{ id:'u1_2026-08-02', sortOrder:0, payload:{ id:'u1_2026-08-02', lastTick:'2026-08-02T10:00:00.000Z' } }] };
  const incomingParts = { attendanceLogs:[{ id:'u1_2026-08-02', sortOrder:50, payload:{ id:'u1_2026-08-02', lastTick:new Date('2026-08-02T10:05:00.000Z'), optional:undefined } }] };
  const prepared = prepareRelationalWrite(existingParts, incomingParts, ['attendanceLogs'], { attendanceLogs:['u1_2026-08-02'] });
  assert.equal(prepared.writeParts.attendanceLogs[0].sortOrder, 0);
  assert.equal(prepared.writeParts.attendanceLogs[0].payload.lastTick, '2026-08-02T10:05:00.000Z');
  assert.equal('optional' in prepared.writeParts.attendanceLogs[0].payload, false);
  assert.deepEqual(prepared.writeParts.attendanceLogs[0].payload, prepared.committedParts.attendanceLogs[0].payload);
});

test('relational persistence hashes PostgreSQL read-back and protects metadata with compare-and-swap', () => {
  assert.match(repository, /const physical = await readPhysicalStateAfterWrite/);
  assert.match(repository, /assertSelectedCollectionsMatchPhysical/);
  assert.match(repository, /const hash = stateSnapshotHash\(committedState, \{ cacheTopLevel:true \}\)/);
  assert.match(repository, /WHERE key=\$1 AND state_version=\$5 AND snapshot_hash=\$6/);
  assert.match(repository, /RELATIONAL_METADATA_COMPARE_AND_SWAP_FAILED/);
  assert.match(repository, /RELATIONAL_SHADOW_HASH_DIVERGENCE/);
  assert.match(repository, /preserveExistingSortOrder:rowSelections\.has\(key\)/);
});

test('selected-row diagnostics identify the collection row and changed fields without logging payloads', () => {
  assert.match(repository, /expectedPayloadHash/);
  assert.match(repository, /physicalPayloadHash/);
  assert.match(repository, /changedFields/);
  assert.doesNotMatch(repository, /error\.expectedPayload\s*=/);
  assert.doesNotMatch(repository, /error\.physicalPayload\s*=/);
});

test('presence writes are active and defer safely instead of disabling or poisoning the whole API', () => {
  assert.doesNotMatch(server, /KALPA_PRESENCE_WRITE_FAILSAFE_V1/);
  assert.doesNotMatch(server, /KALPA_DISABLE_AUTO_PRESENCE_WRITES/);
  assert.match(server, /PRESENCE_PERSISTENCE_DEFERRED/);
  assert.match(server, /presence_persistence_deferred/);
  assert.match(server, /if \(!startupFailure\)/);
  assert.match(server, /schedulePresenceFlush\(PRESENCE_FLUSH_RETRY_MS\)/);
});

test('verified startup resolves stale persistence failures before reporting readiness', () => {
  assert.match(server, /reason:'startup_integrity_verified'/);
  assert.match(server, /await operationalJobs\.resolveFailures\('STATE_PERSISTENCE'/);
});

test('the verified relational shadow is immutable between commits', () => {
  assert.match(server, /function freezeRelationalShadow/);
  assert.match(server, /return Object\.freeze\(value\)/);
  assert.match(server, /relationalShadowState = ownRelationalShadow/);
});

test('deployment removes the emergency bypass only after backup, integrity and certification gates', () => {
  const backupIndex = deployment.indexOf('npm run backup:create');
  const integrityIndex = deployment.indexOf('npm run db:integrity --prefix backend');
  const removeBypassIndex = deployment.indexOf("sed -i '/^[[:space:]]*KALPA_DISABLE_AUTO_PRESENCE_WRITES");
  const certifyIndex = deployment.indexOf('npm run release:certify');
  const startIndex = deployment.indexOf('pm2 start "$RELEASE_ROOT/backend/src/server.js"');
  assert.ok(backupIndex >= 0 && integrityIndex > backupIndex);
  assert.ok(removeBypassIndex > integrityIndex);
  assert.ok(certifyIndex > removeBypassIndex);
  assert.ok(startIndex > certifyIndex);
  assert.match(deployment, /rsync -a --delete/);
  assert.match(deployment, /restore_previous_runtime/);
});

test('historical persistence failures become succeeded after a healthy commit', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kalpa-jobs-'));
  try {
    const jobs = createOperationalJobStore({ dataDir:tempRoot, usePostgres:false });
    await jobs.recordFailure('STATE_PERSISTENCE', new Error('temporary failure'), { reason:'presence_login' }, { dedupKey:'presence_login' });
    assert.equal((await jobs.list({ status:'FAILED' })).length, 1);
    const resolved = await jobs.resolveFailures('STATE_PERSISTENCE', { stateVersion:626 });
    assert.equal(resolved, 1);
    assert.equal((await jobs.list({ status:'FAILED' })).length, 0);
    assert.equal((await jobs.list({ status:'SUCCEEDED' })).length, 1);
  } finally {
    fs.rmSync(tempRoot, { recursive:true, force:true });
  }
});
