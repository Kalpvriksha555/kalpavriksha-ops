import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const taskService = fs.readFileSync(new URL('../../frontend/src/services/taskService.js', import.meta.url), 'utf8');

const detailStart = app.indexOf('const TaskDetailView');
const detailEnd = app.indexOf('class AppErrorBoundary', detailStart);
const detail = app.slice(detailStart, detailEnd);
const buildFinanceStart = detail.indexOf('const buildFinanceProjectFromDraft');
const queueLedgerStart = detail.indexOf('const queueLedgerDraftForBackgroundSync', buildFinanceStart);
const updateLedgerStart = detail.indexOf('const updateLedger', queueLedgerStart);
const flushLedgerStart = detail.indexOf('const flushLedgerOnFieldExit', updateLedgerStart);
const printStart = detail.indexOf('const handlePrintReceipt', flushLedgerStart);
const buildFinanceBlock = detail.slice(buildFinanceStart, queueLedgerStart);
const queueLedgerBlock = detail.slice(queueLedgerStart, updateLedgerStart);
const updateLedgerBlock = detail.slice(updateLedgerStart, flushLedgerStart);
const flushLedgerBlock = detail.slice(flushLedgerStart, printStart);

const financeWorkerStart = app.indexOf("if (!USE_BACKEND_STATE || !backendStateReady || !isDbReady || !currentUser || currentUser.role !== ROLES.ADMIN)");
const financeWorkerEnd = app.indexOf('// Phase 4: chat, notification, presence, task and finance changes', financeWorkerStart);
const financeWorker = app.slice(financeWorkerStart, financeWorkerEnd);

const updateProjectStart = app.indexOf('const handleUpdateProject');
const paymentStatusStart = app.indexOf('const handlePaymentStatusChange', updateProjectStart);
const updateProjectBlock = app.slice(updateProjectStart, paymentStatusStart);

test('automatic ledger status follows estimate and received amount', () => {
  assert.match(buildFinanceBlock, /derivePaymentTrackingStatusFromData/);
  assert.match(buildFinanceBlock, /paymentTrackingStatus:computedStatus/);
  assert.match(buildFinanceBlock, /paymentReceived:amountIn > 0/);
});

test('payment ledger auto-saves after a short pause and flushes on field exit', () => {
  assert.match(updateLedgerBlock, /setLedgerDraft\(nextDraft\)/);
  assert.match(updateLedgerBlock, /queueLedgerDraftForBackgroundSync\(nextDraft\)/);
  assert.match(queueLedgerBlock, /queueFinanceDraft/);
  assert.match(queueLedgerBlock, /setTimeout/);
  assert.match(queueLedgerBlock, /650/);
  assert.match(queueLedgerBlock, /requestFinanceOutboxFlush/);
  assert.match(detail, /onBlurCapture=\{flushLedgerOnFieldExit\}/);
  assert.match(flushLedgerBlock, /requestFinanceOutboxFlush/);
  assert.doesNotMatch(detail, /Save Payment Details/);
  assert.doesNotMatch(detail, /Typing does not write to the server/);
  assert.doesNotMatch(detail, /isSavingLedger/);
});

test('automatic finance saving remains editable while sync runs and restores durable drafts', () => {
  assert.match(detail, /getFinanceOutboxRecord/);
  assert.match(detail, /ledgerDraftRef/);
  assert.match(detail, /Queued safely • auto-saving/);
  assert.match(detail, /Syncing in background/);
  assert.match(detail, /Needs attention/);
  assert.match(detail, /Changes are secured immediately in the durable browser outbox/);
  assert.doesNotMatch(detail, /disabled=\{isSavingLedger\}/);
});

test('background finance worker waits for the debounce flush and drains a newer edit after confirmation', () => {
  assert.match(financeWorker, /window\.addEventListener\(FINANCE_FLUSH_EVENT, flush\)/);
  assert.doesNotMatch(financeWorker, /window\.addEventListener\(FINANCE_SYNC_EVENT, flush\)/);
  assert.doesNotMatch(financeWorker, /financeSyncSnapshot\.total/);
  assert.match(financeWorker, /advancement\?\.newerPending/);
  assert.match(financeWorker, /250/);
  assert.match(financeWorker, /setInterval\(flush, 15000\)/);
});

test('finance-only saves do not perform a second full task write', () => {
  const financeReturn = updateProjectBlock.indexOf('if (financeOnly)');
  const generalTaskSave = updateProjectBlock.indexOf('createTaskApi');
  assert.ok(financeReturn >= 0, 'finance-only return branch is required');
  assert.ok(generalTaskSave > financeReturn, 'full task save must occur only after finance-only branch');
  assert.match(updateProjectBlock, /return updatedProject;/);
  assert.match(updateProjectBlock, /financeSaveInFlightRef/);
});

test('finance API uses one mutation id and a bounded deadline without parallel retries', () => {
  assert.match(taskService, /const FINANCE_WRITE_TIMEOUT_MS = 45 \* 1000/);
  assert.match(taskService, /mutationId/);
  assert.match(taskService, /FINANCE_SAVE_TIMEOUT/);
  assert.doesNotMatch(taskService, /for \(let attempt = 0; attempt < 2/);
});

test('payment receipt uses private upload then links itself through automatic background sync', () => {
  const screenshotStart = detail.indexOf('const handleLedgerScreenshot');
  const screenshotEnd = detail.indexOf('const handleAddSubTask', screenshotStart);
  const screenshotBlock = detail.slice(screenshotStart, screenshotEnd);
  assert.match(screenshotBlock, /uploadProjectFile/);
  assert.doesNotMatch(screenshotBlock, /fileToBase64/);
  assert.match(screenshotBlock, /queueLedgerDraftForBackgroundSync\(nextDraft, \{ flush:true/);
  assert.match(screenshotBlock, /syncing automatically/);
});

test('automatic finance saving flushes before navigation and only warns for an unprotected draft', () => {
  assert.match(detail, /beforeunload/);
  assert.match(detail, /if \(!ledgerDraftUnsafe\) return undefined/);
  assert.match(detail, /ledgerDraftUnsafeRef\.current/);
  assert.match(detail, /requestFinanceOutboxFlush\(\)/);
  assert.match(detail, /onClick=\{handleTaskBack\}/);
  assert.doesNotMatch(detail, /Payment details have unsaved changes\. Leave this task and discard them/);
});
