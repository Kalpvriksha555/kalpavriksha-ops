import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaymentTrackingUpdate,
  derivePaymentTrackingStatusFromData,
  getPaymentReceivedAmount,
  getPaymentTrackingStatus
} from '../../frontend/src/utils/paymentStatusUtils.js';
import { formatCallDuration, formatDuration, formatMinutes } from '../../frontend/src/utils/date.js';
import { allProjectDocs, formatTaskId, getLatestCompletedFileName } from '../../frontend/src/utils/taskDisplayUtils.js';

test('partial payments remain pending and preserve the amount', () => {
  const project = { id: 'CASE-1', estimate: 10000, paymentAmountIn: 0 };
  const updated = buildPaymentTrackingUpdate(project, 'Paid', { name: 'Admin' }, { amountIn: 5000, mode: 'UPI', transactionId: 'TX-1' });
  assert.equal(updated.paymentTrackingStatus, 'Pending');
  assert.equal(getPaymentReceivedAmount(updated), 5000);
  assert.equal(updated.ledger.mode, 'UPI');
  assert.equal(updated.ledger.txnId, 'TX-1');
});

test('stale paid labels cannot override missing payment data', () => {
  assert.equal(getPaymentTrackingStatus({ paymentTrackingStatus: 'Paid', estimate: 5000, paymentAmountIn: 0 }), 'Pending');
  assert.equal(derivePaymentTrackingStatusFromData({ estimate: 0, paymentAmountIn: 0 }), 'Not Updated');
});

test('duration formatting is deterministic', () => {
  assert.equal(formatCallDuration(1000, 62000), '01:01');
  assert.equal(formatDuration(0, 60000), '-');
  assert.equal(formatDuration(1000, 61000), '1m');
  assert.equal(formatMinutes(125), '2h 5m');
});

test('task document helpers deduplicate and select the latest final file', () => {
  const project = {
    id: 'CASE-1',
    documents: [
      { id: 'a', name: 'source.pdf', purpose: 'SOURCE', uploadedAt: 1 },
      { id: 'b', name: 'first.pdf', purpose: 'FINAL', uploadedAt: 2 }
    ],
    completedFiles: [
      { id: 'b', name: 'first.pdf', purpose: 'FINAL', uploadedAt: 2 },
      { id: 'c', name: 'latest.dwg', purpose: 'FINAL', uploadedAt: 3 }
    ]
  };
  assert.equal(allProjectDocs(project).length, 3);
  assert.equal(getLatestCompletedFileName(project), 'latest.dwg');
  assert.equal(formatTaskId('VNS-PNB-1'), 'VNS-PNB-01');
});
