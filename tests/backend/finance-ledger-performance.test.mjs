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
