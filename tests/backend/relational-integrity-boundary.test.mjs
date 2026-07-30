import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decomposeState,
  RELATIONAL_MIGRATIONS,
  stateSnapshotHash,
  verifyPersistedRelationalSnapshot
} from '../../backend/src/repositories/postgresStateRepository.js';

test('persisted integrity is verified before runtime-derived collections are added', () => {
  const persisted = {
    users: [],
    cases: [{ id: 'CASE-1', status: 'COMPLETED', documents: [{ id: 'FILE-1' }] }],
    deletedProjectIds: [],
    payments: [],
    performanceRecords: [],
    notifications: [],
    teamChat: [],
    whatsappInbox: [],
    audit: [],
    attendanceLogs: [],
    files: [],
    chatReads: {}
  };
  const parts = decomposeState(persisted);
  const metadata = {
    entity_counts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.length : Object.keys(value || {}).length
    ])),
    snapshot_hash: stateSnapshotHash(persisted)
  };

  const verified = verifyPersistedRelationalSnapshot(parts, metadata);
  assert.deepEqual(verified.persistedState, persisted);

  const runtimeDerived = {
    ...verified.persistedState,
    performanceRecords: [{ id: 'CASE-1::designer' }],
    files: [{ id: 'FILE-1' }]
  };
  assert.notEqual(stateSnapshotHash(runtimeDerived), metadata.snapshot_hash);
});

test('persisted integrity still rejects a real relational row mismatch', () => {
  const persisted = {
    users: [],
    cases: [{ id: 'CASE-1' }],
    deletedProjectIds: [],
    payments: [],
    performanceRecords: [],
    notifications: [],
    teamChat: [],
    whatsappInbox: [],
    audit: [],
    attendanceLogs: [],
    files: [],
    chatReads: {}
  };
  const parts = decomposeState(persisted);
  const metadata = {
    entity_counts: { cases: 2 },
    snapshot_hash: stateSnapshotHash(persisted)
  };

  assert.throws(
    () => verifyPersistedRelationalSnapshot(parts, metadata),
    error => error?.code === 'RELATIONAL_STATE_INTEGRITY_FAILURE'
  );
});

test('legacy orphan guard permits only an unchanged existing reference', () => {
  const migration = RELATIONAL_MIGRATIONS.find(item => item.version === '009.001');
  assert.ok(migration);
  assert.match(migration.sql, /TG_OP = 'UPDATE'/);
  assert.match(migration.sql, /OLD\.case_id IS NOT DISTINCT FROM NEW\.case_id/);
  assert.match(migration.sql, /kalpa\.allow_legacy_orphans/);
  assert.match(migration.sql, /RAISE EXCEPTION 'Unknown case reference/);
});
