import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { derivePaymentTrackingStatusFromData } from '../../frontend/src/utils/paymentStatusUtils.js';

const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
const taskService = fs.readFileSync(new URL('../../frontend/src/services/taskService.js', import.meta.url), 'utf8');

const detailStart = app.indexOf('const TaskDetailView');
const detailEnd = app.indexOf('class AppErrorBoundary', detailStart);
const detail = app.slice(detailStart, detailEnd);
const updateLedgerStart = detail.indexOf('const updateLedger');
const saveLedgerStart = detail.indexOf('const handleSaveLedger', updateLedgerStart);
const updateLedgerBlock = detail.slice(updateLedgerStart, saveLedgerStart);
const saveLedgerEnd = detail.indexOf('const handlePrintReceipt', saveLedgerStart);
const saveLedgerBlock = detail.slice(saveLedgerStart, saveLedgerEnd);

const updateProjectStart = app.indexOf('const handleUpdateProject');
const paymentStatusStart = app.indexOf('const handlePaymentStatusChange', updateProjectStart);
const updateProjectBlock = app.slice(updateProjectStart, paymentStatusStart);

test('automatic ledger status follows estimate and received amount', () => {
  assert.equal(derivePaymentTrackingStatusFromData({ estimate:5000, ledger:{ amountIn:0 } }), 'Pending');
  assert.equal(derivePaymentTrackingStatusFromData({ estimate:5000, ledger:{ amountIn:2500 } }), 'Pending');
  assert.equal(derivePaymentTrackingStatusFromData({ estimate:5000, ledger:{ amountIn:5000 } }), 'Paid');
  assert.equal(derivePaymentTrackingStatusFromData({ estimate:5000, ledger:{ amountIn:6500 } }), 'Paid');
});

test('payment ledger auto-saves after a short pause and flushes on field exit', () => {
  assert.match(app, /const FINANCE_AUTOSAVE_DELAY_MS = 650/);
  assert.match(detail, /ledgerAutosaveTimerRef/);
  assert.match(detail, /setTimeout\(\(\) => \{/);
  assert.match(detail, /handleSaveLedger\(\{ reason:'automatic' \}\)/);
  assert.match(detail, /onBlur=\{flushFinanceAutosave\}/);
  assert.match(detail, /Automatic save/);
  assert.doesNotMatch(detail, /Save Payment Details/);
  assert.match(saveLedgerBlock, /onUpdateProject\(updatedProject, baseProject, \{/);
  assert.match(saveLedgerBlock, /financeOnly:true/);
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

test('payment receipt uses private file upload instead of embedding base64 in the task', () => {
  const screenshotStart = detail.indexOf('const handleLedgerScreenshot');
  const screenshotEnd = detail.indexOf('const handleAddSubTask', screenshotStart);
  const screenshotBlock = detail.slice(screenshotStart, screenshotEnd);
  assert.match(screenshotBlock, /uploadProjectFile/);
  assert.doesNotMatch(screenshotBlock, /fileToBase64/);
  assert.match(detail, /isUploadingLedgerReceipt/);
});

test('automatic finance saving flushes before navigation and still protects failed drafts', () => {
  assert.match(detail, /beforeunload/);
  assert.match(detail, /Saving payment changes before leaving/);
  assert.match(detail, /Payment details could not be saved automatically/);
  assert.match(detail, /onClick=\{handleTaskBack\}/);
});
