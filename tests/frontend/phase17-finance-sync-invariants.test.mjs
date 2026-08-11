import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFreshestTaskFinance } from '../../frontend/src/utils/financeMergeUtils.js';

test('frontend task merge never lets a lower financeVersion win because its clock is later', () => {
  const current = {
    id:'CASE-1',
    updatedAt:100,
    financeVersion:8,
    paymentTrackingUpdatedAt:new Date('2026-08-10T10:00:00Z').getTime(),
    paymentAmountIn:800,
    transactionId:'TX-8',
    ledger:{ amountIn:800, updatedAt:new Date('2026-08-10T10:00:00Z').getTime(), screenshot:{ id:'receipt-8' } },
    paymentAuditTrail:[{ id:'audit-8', at:'2026-08-10T10:00:00Z' }],
  };
  const stale = {
    id:'CASE-1',
    updatedAt:200,
    financeVersion:7,
    paymentTrackingUpdatedAt:new Date('2026-08-10T12:00:00Z').getTime(),
    paymentAmountIn:700,
    ledger:{ amountIn:700, updatedAt:new Date('2026-08-10T12:00:00Z').getTime() },
  };
  const merged = applyFreshestTaskFinance({ ...current, ...stale }, current, stale);
  assert.equal(merged.financeVersion, 8);
  assert.equal(merged.paymentAmountIn, 800);
  assert.equal(merged.transactionId, 'TX-8');
});

test('frontend compact finance delta cannot erase omitted receipt or audit fields', () => {
  const current = {
    id:'CASE-2',
    updatedAt:100,
    financeVersion:3,
    paymentAmountIn:300,
    transactionId:'TX-KEEP',
    ledger:{ amountIn:300, screenshot:{ id:'receipt-keep' } },
    paymentAuditTrail:[{ id:'audit-keep' }],
  };
  const compact = {
    id:'CASE-2',
    updatedAt:200,
    financeVersion:4,
    paymentAmountIn:400,
    ledger:{ amountIn:400, screenshot:{ id:'receipt-keep' } },
  };
  const merged = applyFreshestTaskFinance({ ...current, ...compact }, current, compact);
  assert.equal(merged.financeVersion, 4);
  assert.equal(merged.paymentAmountIn, 400);
  assert.equal(merged.transactionId, 'TX-KEEP');
  assert.deepEqual(merged.paymentAuditTrail, [{ id:'audit-keep' }]);
});

import fs from 'node:fs';

test('both frontend project merge paths use the same finance-version-aware helper', () => {
  const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
  const taskService = fs.readFileSync(new URL('../../frontend/src/services/taskService.js', import.meta.url), 'utf8');
  assert.match(app, /applyFreshestTaskFinance\(base, a, b\)/);
  assert.match(taskService, /applyFreshestTaskFinance\(merged, a, b\)/);
});
