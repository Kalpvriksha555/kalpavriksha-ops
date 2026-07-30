import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceHash,
  caseFreshness,
  mergeRecoveryIntoState,
  recoveryTimestamp,
  validateRecoveryExport
} from '../../backend/scripts/july30-recovery-lib.mjs';
import { loadStateForJuly30Recovery } from '../../backend/scripts/july30-recovery-state.mjs';
import { rowsRequiringRelationalWrite } from '../../backend/src/repositories/postgresStateRepository.js';

const makeCases = () => Array.from({ length: 404 }, (_, index) => ({
  id: `TASK-${String(index + 1).padStart(3, '0')}`,
  status: index < 34 ? 'In Progress' : 'Completed',
  updatedAt: index < 34
    ? Date.parse('2026-07-30T08:49:27.328Z') - index
    : Date.parse('2026-07-29T07:00:00.000Z') - index,
  timeline: index === 0 ? [{ at: '30/7/2026, 2:02:05 pm' }] : [],
  paymentAmountIn: index === 0 ? 100 : 0
}));

test('mixed Indian and browser-locale timestamps normalize without future-date overflow', () => {
  const maxTimestamp = Date.parse('2026-07-30T09:09:09.534Z');
  assert.equal(
    new Date(recoveryTimestamp('30/7/2026, 2:02:05 pm', { maxTimestamp })).toISOString(),
    '2026-07-30T08:32:05.000Z'
  );
  assert.equal(
    new Date(recoveryTimestamp('7/30/2026, 2:17:49 PM', { maxTimestamp })).toISOString(),
    '2026-07-30T08:47:49.000Z'
  );
  assert.equal(recoveryTimestamp('2026-10-07T12:20:28.000Z', { maxTimestamp }), 0);
});

test('July 30 evidence gate requires 404 unique tasks and 34 fresh tasks', () => {
  const payload = { exportedAt: '2026-07-30T09:04:09.534Z', projectsBackup: makeCases() };
  const evidence = validateRecoveryExport(payload);
  assert.equal(evidence.caseCount, 404);
  assert.equal(evidence.freshCount, 34);
  assert.ok(evidence.latestTimestamp <= Date.parse(payload.exportedAt) + 5 * 60 * 1000);
});

test('recovery merges missing operations while preserving live finance and attendance', () => {
  const sourceCases = makeCases();
  sourceCases[0].status = 'Internal Review';
  sourceCases[0].updatedAt = Date.parse('2026-07-30T08:49:27.328Z');
  const payload = { exportedAt: '2026-07-30T09:04:09.534Z', projectsBackup: sourceCases };
  const live = {
    users: [{ id: 'u1' }],
    cases: [{
      id: 'TASK-001',
      status: 'Drafting',
      updatedAt: Date.parse('2026-07-29T07:00:00.000Z'),
      paymentAmountIn: 999,
      paymentTrackingStatus: 'Paid',
      timeline: []
    }],
    attendanceLogs: [{ id: 'att-1', userId: 'u1', date: '2026-07-30', status: 'PRESENT' }],
    notifications: [{ id: 'n1' }],
    deletedProjectIds: []
  };
  const attendanceBefore = attendanceHash(live);
  const result = mergeRecoveryIntoState(live, payload);
  assert.equal(result.state.cases.length, 404);
  assert.equal(result.summary.added, 403);
  assert.equal(result.state.cases[0].status, 'Internal Review');
  assert.equal(result.state.cases[0].paymentAmountIn, 999);
  assert.equal(result.state.cases[0].paymentTrackingStatus, 'Paid');
  assert.equal(attendanceHash(result.state), attendanceBefore);
  assert.equal(
    caseFreshness(result.state.cases[0], { maxTimestamp: result.evidence.maxTimestamp }),
    Date.parse('2026-07-30T08:49:27.328Z')
  );
});

test('recovery planning reads legacy app_state without migrating or writing it', async () => {
  const liveState = {
    cases: [{ id: 'LEGACY-1' }],
    attendanceLogs: [{ id: 'attendance-1' }]
  };
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('to_regclass')) {
        return { rows: [{ metadata: 'app_state_metadata', legacy: 'app_state' }] };
      }
      if (sql.includes('FROM app_state_metadata')) return { rows: [] };
      if (sql.includes('FROM app_state ')) {
        return { rows: [{ value: liveState, state_version: 27 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  let migrated = false;
  let reloaded = false;
  const loaded = await loadStateForJuly30Recovery(pool, {
    mode: 'plan',
    loadRelationalStateFn: async () => {
      migrated = true;
      throw new Error('plan must not migrate');
    },
    reloadRelationalStateFn: async () => {
      reloaded = true;
      throw new Error('metadata row is absent');
    }
  });

  assert.equal(loaded.source, 'legacy-app-state-read-only');
  assert.equal(loaded.stateVersion, 27);
  assert.deepEqual(loaded.state, liveState);
  assert.equal(migrated, false);
  assert.equal(reloaded, false);
  assert.equal(queries.length, 3);
});

test('recovery apply imports an existing legacy state before persisting the merge', async () => {
  const liveState = { cases: [{ id: 'LEGACY-1' }], attendanceLogs: [] };
  const pool = {
    async query(sql) {
      if (sql.includes('to_regclass')) {
        return { rows: [{ metadata: 'app_state_metadata', legacy: 'app_state' }] };
      }
      if (sql.includes('FROM app_state_metadata')) return { rows: [] };
      if (sql.includes('FROM app_state ')) {
        return { rows: [{ value: liveState, state_version: 27 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  let imports = 0;
  const loaded = await loadStateForJuly30Recovery(pool, {
    mode: 'apply',
    loadRelationalStateFn: async () => {
      imports += 1;
      return { state: liveState, stateVersion: 27, source: 'legacy_app_state_import' };
    }
  });

  assert.equal(imports, 1);
  assert.equal(loaded.source, 'legacy_app_state_import');
  assert.deepEqual(loaded.state, liveState);
});

test('recovery fails closed when neither relational metadata nor legacy state exists', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('to_regclass')) return { rows: [{ metadata: null, legacy: null }] };
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  await assert.rejects(
    loadStateForJuly30Recovery(pool, { mode: 'plan' }),
    /No authoritative live state/
  );
});

test('relational persistence skips unchanged legacy orphans but writes changed and new rows', () => {
  const existing = [{
    id: 'legacy-payment-1',
    sortOrder: 4,
    payload: { caseId: 'KNP-MUTH-SHUB-01', amount: 100, nested: { a: 1, b: 2 } }
  }];
  const unchangedWithDifferentKeyOrder = {
    id: 'legacy-payment-1',
    sortOrder: 4,
    payload: { nested: { b: 2, a: 1 }, amount: 100, caseId: 'KNP-MUTH-SHUB-01' }
  };
  const changed = { ...unchangedWithDifferentKeyOrder, sortOrder: 5 };
  const added = { id: 'new-payment', sortOrder: 6, payload: { caseId: 'KNOWN-CASE', amount: 50 } };

  assert.deepEqual(rowsRequiringRelationalWrite([unchangedWithDifferentKeyOrder], existing), []);
  assert.deepEqual(rowsRequiringRelationalWrite([changed, added], existing), [changed, added]);
});
