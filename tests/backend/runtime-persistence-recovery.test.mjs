import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyPersistenceFailure,
  isDeferredPersistenceOperation,
  persistenceReadiness,
  preserveDirtyPresenceAfterReload
} from '../../backend/src/services/persistenceBackpressureService.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');

test('presence and explicit background persistence are isolated from foreground availability', () => {
  assert.equal(isDeferredPersistenceOperation({ reason:'presence_logout' }), true);
  assert.equal(isDeferredPersistenceOperation({ reason:'presence_heartbeat_batch' }), true);
  assert.equal(isDeferredPersistenceOperation({ metadata:{ background:true }, reason:'maintenance_probe' }), true);
  assert.equal(isDeferredPersistenceOperation({ reason:'finance_payment_update' }), false);
});

test('a verified PostgreSQL reload makes a rejected foreground write non-critical', () => {
  assert.deepEqual(classifyPersistenceFailure({
    reason:'finance_payment_update',
    recoverySucceeded:true,
    usePostgres:true
  }), {
    deferred:false,
    safelyRecovered:true,
    critical:false,
    jobType:'STATE_PERSISTENCE'
  });
});

test('an unrecovered foreground failure remains fail-closed', () => {
  const disposition = classifyPersistenceFailure({
    reason:'task_update',
    recoverySucceeded:false,
    verifiedFallbackRestored:false,
    usePostgres:true
  });
  assert.equal(disposition.critical, true);
  assert.equal(disposition.jobType, 'STATE_PERSISTENCE');
  assert.equal(persistenceReadiness({ criticalFailure:{ code:'DB_DOWN' } }), false);
});

test('deferred presence failure does not poison readiness and keeps its own job class', () => {
  const disposition = classifyPersistenceFailure({
    reason:'presence_logout',
    verifiedFallbackRestored:true,
    usePostgres:true
  });
  assert.equal(disposition.deferred, true);
  assert.equal(disposition.critical, false);
  assert.equal(disposition.jobType, 'PRESENCE_PERSISTENCE');
  assert.equal(persistenceReadiness({ criticalFailure:null }), true);
  assert.equal(typeof persistenceReadiness({ criticalFailure:null }), 'boolean');
});

test('verified shadow rollback preserves newer presence rows without retaining a failed business write', () => {
  const verified = {
    cases:[{ id:'case-1', status:'ASSIGNED' }],
    users:[{ id:'u1', availability:'Available' }],
    attendanceLogs:[{ id:'u1_2026-08-07', action:'login' }]
  };
  const optimistic = {
    cases:[{ id:'case-1', status:'COMPLETED' }],
    users:[{ id:'u1', availability:'Unavailable' }],
    attendanceLogs:[{ id:'u1_2026-08-07', action:'logout' }]
  };
  const recovered = preserveDirtyPresenceAfterReload({
    committedState:verified,
    liveState:optimistic,
    mutationGeneration:3,
    persistedGeneration:2
  });
  assert.equal(recovered.cases[0].status, 'ASSIGNED');
  assert.equal(recovered.users[0].availability, 'Unavailable');
  assert.equal(recovered.attendanceLogs[0].action, 'logout');
});

test('server integrates deferred rollback, strict foreground maintenance and read-only runtime access', () => {
  assert.match(server, /restoreVerifiedShadowAfterPersistenceFailure\(expectedVersion\)/);
  assert.match(server, /runtime_deferred_recovery_preserved/);
  assert.match(server, /phase:'runtime'/);
  assert.match(server, /lastCriticalPersistenceFailure/);
  assert.match(server, /lastDeferredPersistenceFailure/);
  assert.match(server, /disposition\.jobType/);
  assert.match(server, /runtimeReadOnly/);
  assert.match(server, /const healthy=processAlive;/);
  assert.match(server, /PRESENCE_PERSISTENCE/);
});
