import test from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentEstimateAmount, getPaymentReceivedAmount, getPaymentTrackingStatus } from '../../frontend/src/utils/paymentStatusUtils.js';
import { applyFreshestTaskFinance } from '../../frontend/src/utils/financeMergeUtils.js';

test('zero legacy estimate cannot mask a real positive estimate', () => {
  const project = { id:'CASE-1', estimate:0, estimateAmount:1000, ledger:{amountIn:500}, paymentTrackingStatus:'Paid' };
  assert.equal(getPaymentEstimateAmount(project),1000);
  assert.equal(getPaymentReceivedAmount(project),500);
  assert.equal(getPaymentTrackingStatus(project),'Pending');
});

test('once a full payment is confirmed, an older Pending refresh cannot downgrade it', () => {
  const paid = { id:'CASE-2',financeVersion:12,estimate:1000,ledger:{amountIn:1000},paymentAmountIn:1000,paymentTrackingStatus:'Paid' };
  const stale = { id:'CASE-2',financeVersion:11,estimate:1000,ledger:{amountIn:0},paymentAmountIn:0,paymentTrackingStatus:'Pending',paymentTrackingUpdatedAt:Date.now()+600000 };
  const merged = applyFreshestTaskFinance({...paid,...stale},paid,stale);
  assert.equal(merged.financeVersion,12);
  assert.equal(getPaymentTrackingStatus(merged),'Paid');
});
