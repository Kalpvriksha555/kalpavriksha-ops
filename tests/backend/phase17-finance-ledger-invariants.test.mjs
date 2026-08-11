import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyFreshestFinance,
  chooseFreshestFinanceSource,
  financeMutationFingerprint,
  findFinanceMutationReceipt,
  rememberFinanceMutationReceipt,
} from '../../backend/src/services/financeIntegrityService.js';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');

const paymentStatusStart = server.indexOf("app.post('/api/state/projects/:id/payment-status'");
const legacyStart = server.indexOf("app.post('/api/cases/:id/payment'", paymentStatusStart);
const paymentStatusRoute = server.slice(paymentStatusStart, legacyStart);
const legacyEnd = server.indexOf("app.get('/api/finance/history/:id'", legacyStart);
const legacyRoute = server.slice(legacyStart, legacyEnd);

test('financeVersion wins over a later stale browser timestamp', () => {
  const current = {
    financeVersion:9,
    paymentTrackingUpdatedAt:new Date('2026-08-10T10:00:00Z').getTime(),
    paymentAmountIn:900,
    ledger:{ amountIn:900, updatedAt:new Date('2026-08-10T10:00:00Z').getTime() },
  };
  const staleButClockAhead = {
    financeVersion:8,
    paymentTrackingUpdatedAt:new Date('2026-08-10T12:00:00Z').getTime(),
    paymentAmountIn:800,
    ledger:{ amountIn:800, updatedAt:new Date('2026-08-10T12:00:00Z').getTime() },
  };
  assert.equal(chooseFreshestFinanceSource(current, staleButClockAhead), current);
  assert.equal(applyFreshestFinance({ id:'CASE-1' }, current, staleButClockAhead).paymentAmountIn, 900);
});

test('partial finance patches cannot erase durable fields they omit', () => {
  const current = {
    financeVersion:4,
    paymentAmountIn:400,
    transactionId:'TX-KEEP',
    ledger:{ amountIn:400, screenshot:{ id:'receipt-1' } },
    paymentAuditTrail:[{ id:'audit-1' }],
  };
  const partial = {
    financeVersion:5,
    paymentAmountIn:500,
    ledger:{ amountIn:500, screenshot:{ id:'receipt-1' } },
  };
  const merged = applyFreshestFinance({ ...current }, current, partial);
  assert.equal(merged.financeVersion, 5);
  assert.equal(merged.paymentAmountIn, 500);
  assert.equal(merged.transactionId, 'TX-KEEP');
  assert.deepEqual(merged.paymentAuditTrail, [{ id:'audit-1' }]);
});

test('finance mutation fingerprints ignore retry metadata but bind operation and business payload', () => {
  const first = financeMutationFingerprint('payment-status', { mutationId:'m-1', expectedFinanceVersion:3, amountIn:500, mode:'Bank' });
  const retry = financeMutationFingerprint('payment-status', { mutationId:'m-1', expectedFinanceVersion:99, amountIn:500, mode:'Bank' });
  const changed = financeMutationFingerprint('payment-status', { mutationId:'m-1', expectedFinanceVersion:3, amountIn:700, mode:'Bank' });
  const otherOperation = financeMutationFingerprint('payment-ledger', { mutationId:'m-1', expectedFinanceVersion:3, amountIn:500, mode:'Bank' });
  assert.equal(first, retry);
  assert.notEqual(first, changed);
  assert.notEqual(first, otherOperation);
});

test('bounded finance mutation receipts remember older committed mutations', () => {
  const record = { financeVersion:1 };
  for (let index = 1; index <= 80; index += 1) {
    record.financeVersion = index;
    rememberFinanceMutationReceipt(record, {
      mutationId:`m-${index}`,
      fingerprint:`fp-${index}`,
      operation:'payment-status',
      financeVersion:index,
      paymentId:`p-${index}`,
      committedAt:`2026-08-10T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
    });
  }
  assert.equal(record.financeMutationReceipts.length, 64);
  assert.equal(findFinanceMutationReceipt(record, 'm-80')?.paymentId, 'p-80');
  assert.equal(findFinanceMutationReceipt(record, 'm-17')?.paymentId, 'p-17');
  assert.equal(findFinanceMutationReceipt(record, 'm-16'), null);
});

test('payment-status retries wait for an in-flight identical mutation and only replay committed receipts', () => {
  assert.match(server, /async function resolveCommittedFinanceReplay/);
  assert.match(server, /const pendingQueue = persistenceQueue/);
  assert.match(server, /await pendingQueue\.catch\(\(\) => \{\}\)/);
  assert.match(server, /const committedState = USE_POSTGRES \? relationalShadowState : readDb\(\)/);
  assert.match(paymentStatusRoute, /await resolveCommittedFinanceReplay/);
  assert.ok(paymentStatusRoute.indexOf('resolveCommittedFinanceReplay') < paymentStatusRoute.indexOf('assertExpectedFinanceVersion'));
  assert.match(paymentStatusRoute, /idempotent:true/);
});

test('finance mutation ID reuse with different content fails closed', () => {
  assert.match(server, /FINANCE_MUTATION_ID_REUSE/);
  assert.match(server, /assertFinanceMutationReplayMatches/);
  assert.match(paymentStatusRoute, /financeMutationFingerprint\(mutationOperation, req\.body \|\| \{\}\)/);
  assert.match(paymentStatusRoute, /fingerprint:mutationFingerprint/);
});

test('both finance endpoints persist mutation receipts for response-loss recovery', () => {
  assert.match(paymentStatusRoute, /upsertInlinePaymentLedger[\s\S]*fingerprint:mutationFingerprint/);
  assert.match(server, /rememberFinanceMutationReceipt\(c, \{/);
  assert.match(legacyRoute, /mutationOperation='payment-ledger'/);
  assert.match(legacyRoute, /await resolveCommittedFinanceReplay/);
  assert.match(legacyRoute, /rememberFinanceMutationReceipt\(c,/);
});

test('legacy payment endpoint enforces the canonical payment validity rules before persistence', () => {
  assert.match(legacyRoute, /INVALID_PAYMENT_DATE/);
  assert.match(legacyRoute, /PAYMENT_DATE_IN_FUTURE/);
  assert.match(legacyRoute, /REFUND_EXCEEDS_RECEIVED/);
  assert.match(legacyRoute, /PAYMENT_AMOUNT_REQUIRED/);
  assert.ok(legacyRoute.indexOf('REFUND_EXCEEDS_RECEIVED') < legacyRoute.indexOf('const p={'));
  assert.ok(legacyRoute.indexOf('PAYMENT_AMOUNT_REQUIRED') < legacyRoute.indexOf('const p={'));
});

const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');

test('relational finance classifier recognizes mutation receipt metadata as finance-only state', () => {
  const start = repository.indexOf('const FINANCE_CASE_KEYS');
  const end = repository.indexOf(']);', start);
  const block = repository.slice(start, end);
  assert.match(block, /lastFinanceMutationFingerprint/);
  assert.match(block, /lastFinanceMutationOperation/);
  assert.match(block, /financeMutationReceipts/);
});
