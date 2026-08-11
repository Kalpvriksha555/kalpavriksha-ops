import test from 'node:test';
import assert from 'node:assert/strict';
import {
  workspaceSyncMarkersFromPayload,
  advanceWorkspaceSyncMarkers,
  classifyWorkspaceResponseFreshness,
} from '../../frontend/src/utils/workspaceSyncUtils.js';
import { applyFreshestTaskFinance, taskFinanceVersion } from '../../frontend/src/utils/financeMergeUtils.js';
import { computeAttendanceAccrual } from '../../backend/src/services/presenceProtocolService.js';
import { asArray, asRecord, parseJsonArray, parseJsonRecord } from '../../frontend/src/utils/runtimeShapeUtils.js';
import { buildRuntimeDiagnostic } from '../../frontend/src/utils/runtimeDiagnosticsUtils.js';

const collections = ['users','cases','deletedProjectIds','teamChat','notifications','attendanceLogs'];
const revisions = (value) => Object.fromEntries(collections.map(key => [key, value]));

test('fault soak: stale workspace responses never move any browser revision marker backwards', () => {
  let current = workspaceSyncMarkersFromPayload({
    stateVersion:1, dataRevision:1, presenceGeneration:1, collectionRevisions:revisions(1)
  });
  for (let i = 2; i <= 20_000; i += 1) {
    const shouldBeStale = i % 5 === 0;
    const marker = shouldBeStale ? Math.max(0, i - 7) : i;
    const incoming = { stateVersion:marker, dataRevision:marker, presenceGeneration:marker, collectionRevisions:revisions(marker) };
    const result = classifyWorkspaceResponseFreshness(incoming, current, { clientMutationAdvanced:i % 17 === 0 });
    if (!result.stale) current = advanceWorkspaceSyncMarkers(current, incoming);
    assert.ok(current.stateVersion >= 1);
    assert.ok(current.dataRevision >= 1);
    assert.ok(current.presenceGeneration >= 1);
    for (const key of collections) assert.ok(current.collectionRevisions[key] >= 1);
  }
  assert.ok(current.stateVersion > 19_900);
});

test('fault soak: compact finance deltas cannot erase confirmed metadata or regress financeVersion', () => {
  let task = {
    id:'K-1', financeVersion:1, paymentAmountIn:1000, transactionId:'TXN-KEEP',
    paymentAuditTrail:[{at:1,action:'INITIAL'}], ledger:{updatedAt:1,items:[{amount:1000}]}
  };
  for (let version = 2; version <= 2_000; version += 1) {
    const incoming = version % 11 === 0
      ? { financeVersion:version - 5, paymentAmountIn:version * 100 }
      : { financeVersion:version, paymentAmountIn:version * 100 };
    const target = { ...task, ...incoming };
    const merged = applyFreshestTaskFinance(target, task, incoming);
    assert.ok(taskFinanceVersion(merged) >= taskFinanceVersion(task));
    assert.equal(merged.transactionId, 'TXN-KEEP');
    assert.deepEqual(merged.paymentAuditTrail, task.paymentAuditTrail);
    task = merged;
  }
  assert.equal(task.transactionId, 'TXN-KEEP');
  assert.equal(taskFinanceVersion(task), 2_000);
});

test('fault soak: attendance accrues normal minute beats but discards a suspended multi-hour gap', () => {
  let lastTick = Date.parse('2026-08-10T09:00:00+05:30');
  let remainderMs = 0;
  let minutes = 0;
  for (let i = 0; i < 480; i += 1) {
    const now = lastTick + 60_000;
    const accrued = computeAttendanceAccrual({ lastTick, loginAt:lastTick, nowMs:now, remainderMs });
    minutes += accrued.wholeMinutes;
    remainderMs = accrued.remainderMs;
    lastTick = now;
  }
  assert.equal(minutes, 480);
  const afterSleep = computeAttendanceAccrual({ lastTick, loginAt:lastTick, nowMs:lastTick + 3 * 60 * 60_000, remainderMs });
  assert.equal(afterSleep.wholeMinutes, 0);
  assert.equal(afterSleep.remainderMs, 0);
  assert.equal(afterSleep.ignoredGapMinutes, 180);
});

test('fault soak: malformed persisted/browser shapes remain non-throwing at ingestion boundaries', () => {
  const hostile = [null, undefined, '', 'abc', 7, true, {}, {0:'x'}, new Date(), /x/];
  for (let i = 0; i < 10_000; i += 1) {
    const value = hostile[i % hostile.length];
    assert.doesNotThrow(() => asArray(value).some(Boolean));
    assert.doesNotThrow(() => Object.keys(asRecord(value)));
    assert.doesNotThrow(() => parseJsonArray(typeof value === 'string' ? value : JSON.stringify(value ?? null)));
    assert.doesNotThrow(() => parseJsonRecord(typeof value === 'string' ? value : JSON.stringify(value ?? null)));
  }
});

test('fault matrix: a local mutation makes an otherwise newer in-flight workspace read stale', () => {
  const current = { stateVersion:10, dataRevision:10, presenceGeneration:10, collectionRevisions:revisions(10) };
  const incoming = { stateVersion:11, dataRevision:11, presenceGeneration:11, collectionRevisions:revisions(11) };
  const result = classifyWorkspaceResponseFreshness(incoming, current, { clientMutationAdvanced:true });
  assert.equal(result.stale, true);
  assert.ok(result.reasons.includes('client-mutation-advanced'));
});

test('fault matrix: runtime diagnostic keeps correlation but strips raw route identifiers and query data', () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'some')");
  error.code = 'RUNTIME_SHAPE';
  error.stack = 'TypeError: secret\n    at App (https://ops.example/assets/app.js:912:33)';
  const diagnostic = buildRuntimeDiagnostic({
    error,
    source:'window-error',
    operation:'open task "Customer Name" /api/cases/123456?token=SECRET',
    route:'https://ops.example/api/cases/123456?token=SECRET',
    requestId:'req-safe-1',
    context:{ stateVersion:50, dataRevision:70, presenceGeneration:90, authState:'authenticated', authOwned:true },
    appVersion:'2.9.30-ssh-independent-certify-deploy-closure'
  });
  assert.match(diagnostic.diagnosticId, /^KD-[A-F0-9]{12}$/);
  assert.equal(diagnostic.relatedRequestId, 'req-safe-1');
  assert.equal(diagnostic.route, '/api/cases/:id');
  assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET|Customer Name|123456/);
});
