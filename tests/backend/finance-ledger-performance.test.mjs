import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const start = server.indexOf("app.post('/api/state/projects/:id/payment-status'");
const end = server.indexOf("app.post('/api/cases/:id/payment'", start);
const block = server.slice(start, end);

test('inline finance updates persist only the payment row changed by this request', () => {
  assert.match(block, /const changedPaymentId=/);
  assert.match(block, /collectionRowIds\.payments=\[changedPaymentId\]/);
  assert.doesNotMatch(block, /filter\(item=>String\(item\.caseId/);
});

test('finance update response does not resend the complete payment ledger', () => {
  assert.match(block, /payment:changedPayment \|\| null/);
  assert.doesNotMatch(block, /payments:d\.payments/);
});


test('payment accounting period is locked to the task creation month', () => {
  assert.match(server, /function getCaseTaskAccountingPeriod/);
  assert.match(server, /c\.taskAccountingPeriod/);
  assert.match(server, /c\.taskDate/);
  assert.match(server, /c\.createdAt/);
  assert.match(server, /const accountingPeriod = getCaseTaskAccountingPeriod\(c,/);
});

test('task creation accepts a backdate but rejects future dates', () => {
  const createStart = server.indexOf("app.post('/api/state/projects'");
  const createEnd = server.indexOf("app.delete('/api/state/projects", createStart);
  const createBlock = server.slice(createStart, createEnd);
  assert.match(createBlock, /requestedTaskDate/);
  assert.match(createBlock, /TASK_DATE_IN_FUTURE/);
  assert.match(createBlock, /safeIncoming\.taskDate = requestedTaskDate/);
  assert.match(createBlock, /safeIncoming\.taskAccountingPeriod = normalizeFinanceAccountingPeriod/);
  assert.match(createBlock, /safeIncoming\.createdAt = taskDateTimestamp/);
  assert.match(createBlock, /safeIncoming\.recordedAt = recordedAt/);
});
