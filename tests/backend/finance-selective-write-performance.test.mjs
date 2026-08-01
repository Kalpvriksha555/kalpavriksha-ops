import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { prepareFastSelectedRelationalWrite } from '../../backend/src/repositories/postgresStateRepository.js';

const makeRows = (prefix, count) => Array.from({ length: count }, (_, index) => ({
  id:`${prefix}-${index}`,
  updatedAt:'2026-08-01T00:00:00.000Z',
  payload:`${prefix}-${index}`
}));

test('selective finance preparation does not clone unrelated large collections', () => {
  const base = {
    users:makeRows('user', 20),
    cases:[{ id:'case-1', caseId:'CASE-1', financeVersion:1, ledger:{ amountIn:0 } }, ...makeRows('case', 500)],
    payments:[{ id:'payment-1', caseId:'case-1', paymentAmountIn:0 }],
    performanceRecords:makeRows('performance', 5000),
    notifications:makeRows('notification', 5000),
    teamChat:makeRows('chat', 5000),
    whatsappInbox:[],
    audit:makeRows('audit', 5000),
    attendanceLogs:makeRows('attendance', 1000),
    files:makeRows('file', 10000),
    deletedProjectIds:[],
    chatReads:{ ADMIN:[] }
  };
  const incoming = {
    ...base,
    cases:[{ ...base.cases[0], financeVersion:2, ledger:{ amountIn:500 } }, ...base.cases.slice(1)],
    payments:[{ ...base.payments[0], paymentAmountIn:500 }],
    audit:[{ id:'audit-new', at:'2026-08-01T01:00:00.000Z', action:'Payment updated' }, ...base.audit]
  };

  const started = performance.now();
  const prepared = prepareFastSelectedRelationalWrite({
    persistedBaseState:base,
    incomingState:incoming,
    selectedCollections:['cases','payments','audit'],
    collectionRowIds:{ cases:['case-1'], payments:['payment-1'], audit:['audit-new'] }
  });
  const durationMs = performance.now() - started;

  assert.ok(prepared?.fastSelectedWrite);
  assert.equal(prepared.committedState.files, base.files);
  assert.equal(prepared.committedState.performanceRecords, base.performanceRecords);
  assert.equal(prepared.committedState.notifications, base.notifications);
  assert.equal(prepared.committedState.cases[0].financeVersion, 2);
  assert.equal(prepared.committedState.payments[0].paymentAmountIn, 500);
  assert.equal(prepared.committedState.audit[0].id, 'audit-new');
  assert.equal(prepared.counts.files, 10000);
  assert.ok(durationMs < 1000, `selective finance preparation took ${durationMs.toFixed(2)}ms`);
});
