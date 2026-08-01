import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const financeIntegrity = fs.readFileSync(new URL('../../backend/src/services/financeIntegrityService.js', import.meta.url), 'utf8');

const routeStart = server.indexOf("app.post('/api/state/projects/:id/payment-status'");
const routeEnd = server.indexOf("app.post('/api/cases/:id/payment'", routeStart);
const route = server.slice(routeStart, routeEnd);
const upsertStart = server.indexOf('function upsertInlinePaymentLedger');
const upsertEnd = server.indexOf('const PRESENCE_STALE_MS', upsertStart);
const upsert = server.slice(upsertStart, upsertEnd);

test('finance retries are idempotent only against committed relational state', () => {
  assert.match(route, /const committedState = USE_POSTGRES \? relationalShadowState : readDb\(\)/);
  assert.match(route, /committedCase\?\.lastFinanceMutationId === mutationId/);
  assert.match(route, /alreadyCommitted:true/);
  assert.ok(route.indexOf('lastFinanceMutationId === mutationId') < route.indexOf('assertExpectedFinanceVersion'));
});

test('finance writes keep immutable history but avoid a full revision snapshot on every save', () => {
  assert.match(route, /financeEvent:/);
  assert.match(route, /skipRevisionSnapshot:true/);
  assert.match(route, /periodicRevisionSnapshot:true/);
  assert.match(route, /revisionSnapshotInterval:10/);
});

test('inline ledger validates amounts and payment dates before persistence', () => {
  assert.match(upsert, /INVALID_PAYMENT_DATE/);
  assert.match(upsert, /PAYMENT_DATE_IN_FUTURE/);
  assert.match(upsert, /INVALID_FINANCE_AMOUNT/);
  assert.match(upsert, /REFUND_EXCEEDS_RECEIVED/);
});

test('inline ledger reuses a payment row across task id aliases and bounds audit growth', () => {
  assert.match(upsert, /const caseIdentifiers = new Set/);
  assert.match(upsert, /\[payment\.caseId,payment\.caseNo,payment\.taskId\]/);
  assert.match(upsert, /paymentAuditTrail\.length > 500/);
  assert.match(upsert, /c\.history\.length > 1000/);
});

test('finance snapshots include estimate changes for recovery and audit', () => {
  assert.match(financeIntegrity, /'estimate'/);
  assert.match(financeIntegrity, /'estimateAmount'/);
  assert.match(financeIntegrity, /for \(const field of FINANCE_FIELDS\)/);
  assert.match(financeIntegrity, /lastFinanceMutationId/);
});

const repository = fs.readFileSync(new URL('../../backend/src/repositories/postgresStateRepository.js', import.meta.url), 'utf8');

test('finance hot path clones only selected rows and returns a compact finance patch', () => {
  assert.match(server, /function financeDb\(caseId = ''\)/);
  assert.match(server, /const snapshot = \{ \.\.\.memoryState, cases, payments, audit \}/);
  assert.match(route, /takeSnapshotOwnership:true/);
  assert.match(route, /const confirmedProject = financeResponsePatch\(updated\)/);
  assert.doesNotMatch(route, /project:updated, case:updated/);
  assert.match(repository, /prepareFastSelectedRelationalWrite/);
  assert.match(repository, /decomposeOnlyCollections/);
  assert.match(repository, /fastSelectedWrite: true/);
});
